require "bcrypt"
require "date"
require "json"
require "pg"
require "securerandom"
require "time"
require "webrick"

ROOT = File.expand_path(__dir__)
PUBLIC_DIR = File.join(ROOT, "public")
DATA_DIR = File.join(ROOT, "data")
DATA_FILE = File.join(DATA_DIR, "easemyrentals.json")
COOKIE_NAME = "emr_session"
DEFAULT_DATABASE_URL = ENV.fetch("DATABASE_URL", "postgres:///easemyrentals_development")
COLLECTIONS = %w[properties inspections payments assets listings inquiries maintenance_requests notifications].freeze

# Superadmin configuration from environment
SUPERADMIN_EMAIL = ENV.fetch("SUPERADMIN_EMAIL", "admin@easemyrentals.com")
SUPERADMIN_PASSWORD = ENV.fetch("SUPERADMIN_PASSWORD", "admin123")
SUPERADMIN_NAME = ENV.fetch("SUPERADMIN_NAME", "EaseMyRentals Admin")

# Demo passwords for test accounts (owner/tenant only)
DEMO_PASSWORDS = {
  "owner@example.com" => "owner123",
  "owner2@example.com" => "owner123",
  "owner3@example.com" => "owner123",
  "tenant@example.com" => "tenant123",
  "tenant2@example.com" => "tenant123",
  "tenant3@example.com" => "tenant123",
  "tenant4@example.com" => "tenant123",
  "tenant5@example.com" => "tenant123"
}.freeze

class ApiError < StandardError
  attr_reader :status

  def initialize(status, message)
    @status = status
    super(message)
  end
end

class DatabaseClient
  def initialize(database_url = DEFAULT_DATABASE_URL)
    @connection = connect_with_retry(database_url)
    @connection.type_map_for_results = PG::BasicTypeMapForResults.new(@connection)
  end

  def execute(sql, params = [])
    result = if params.empty?
      @connection.exec(sql)
    else
      @connection.exec_params(convert_placeholders(sql), normalize_params(params))
    end

    result.map { |row| row.transform_keys(&:to_s) }
  end

  def execute_batch(sql)
    @connection.exec(sql)
  end

  def get_first_row(sql, params = [])
    execute(sql, params).first
  end

  def get_first_value(sql, params = [])
    row = get_first_row(sql, params)
    row&.values&.first
  end

  def transaction
    execute("BEGIN")
    result = yield(self)
    execute("COMMIT")
    result
  rescue StandardError
    execute("ROLLBACK")
    raise
  end

  def setup_schema!
    execute_batch(
      <<~SQL
        CREATE TABLE IF NOT EXISTS emr_users (
          id BIGINT PRIMARY KEY,
          role TEXT NOT NULL,
          name TEXT NOT NULL,
          email TEXT NOT NULL UNIQUE,
          phone TEXT,
          password_digest TEXT NOT NULL,
          status TEXT NOT NULL,
          occupation TEXT,
          id_proof TEXT,
          emergency_contact TEXT,
          notes TEXT,
          created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS emr_app_records (
          collection TEXT NOT NULL,
          id BIGINT NOT NULL,
          payload TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (collection, id)
        );

        CREATE INDEX IF NOT EXISTS idx_emr_app_records_collection ON emr_app_records (collection);
        CREATE INDEX IF NOT EXISTS idx_emr_users_role ON emr_users (role);
      SQL
    )
  end

  private

  def connect_with_retry(database_url)
    attempts = 0

    begin
      PG.connect(database_url)
    rescue PG::ConnectionBad
      attempts += 1
      raise if attempts >= 12

      sleep 1
      retry
    end
  end

  def convert_placeholders(sql)
    index = 0
    sql.gsub("?") do
      index += 1
      "$#{index}"
    end
  end

  def normalize_params(params)
    params.map do |value|
      case value
      when TrueClass then "t"
      when FalseClass then "f"
      else value
      end
    end
  end
end

class PostgresStore
  def initialize
    @db = DatabaseClient.new
    @mutex = Mutex.new
    @db.setup_schema!
    seed! if @db.get_first_value("SELECT COUNT(*) FROM emr_users").to_i.zero?
  end

  def snapshot
    @mutex.synchronize { snapshot_unlocked }
  end

  def transaction
    @mutex.synchronize do
      @db.transaction do
        data = snapshot_unlocked
        result = yield(data)
        replace_all(data)
        result
      end
    end
  end

  private

  def seed!
    @mutex.synchronize { replace_all(seed_data) }
  end

  def snapshot_unlocked
    data = {
      "users" => @db.execute("SELECT * FROM emr_users ORDER BY id ASC").map { |row| normalize_user(row) }
    }

    COLLECTIONS.each do |collection|
      data[collection] = @db.execute(
        "SELECT payload FROM emr_app_records WHERE collection = ? ORDER BY id ASC",
        [collection]
      ).map { |row| JSON.parse(row["payload"]) }
    end

    data
  end

  def normalize_user(row)
    row.each_with_object({}) do |(key, value), memo|
      memo[key] = key == "id" ? value.to_i : value
    end
  end

  def replace_all(data)
    @db.execute("DELETE FROM emr_app_records")
    @db.execute("DELETE FROM emr_users")

    data.fetch("users", []).each do |user|
      @db.execute(
        <<~SQL,
          INSERT INTO emr_users (
            id, role, name, email, phone, password_digest, status,
            occupation, id_proof, emergency_contact, notes, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        SQL
        [
          user["id"].to_i,
          user["role"].to_s,
          user["name"].to_s,
          user["email"].to_s.downcase,
          user["phone"].to_s,
          user["password_digest"].to_s,
          user["status"].to_s.empty? ? "active" : user["status"].to_s,
          user["occupation"].to_s,
          user["id_proof"].to_s,
          user["emergency_contact"].to_s,
          user["notes"].to_s,
          user["created_at"].to_s.empty? ? Time.now.utc.iso8601 : user["created_at"].to_s
        ]
      )
    end

    COLLECTIONS.each do |collection|
      data.fetch(collection, []).each do |record|
        @db.execute(
          "INSERT INTO emr_app_records (collection, id, payload, created_at) VALUES (?, ?, ?, ?)",
          [collection, record["id"].to_i, JSON.generate(record), record["created_at"].to_s.empty? ? Time.now.utc.iso8601 : record["created_at"].to_s]
        )
      end
    end
  end

  def seed_data
    if File.exist?(DATA_FILE)
      legacy = JSON.parse(File.read(DATA_FILE))
      normalize_legacy_seed(legacy)
    else
      default_seed_data
    end
  rescue JSON::ParserError
    default_seed_data
  end

  def normalize_legacy_seed(data)
    data = default_seed_data.merge(data)
    data["users"] = data.fetch("users", []).map { |user| normalize_seed_user(user) }
    COLLECTIONS.each { |collection| data[collection] ||= [] }
    data
  end

  def normalize_seed_user(user)
    email = user["email"].to_s.downcase
    digest = user["password_digest"].to_s

    user.merge(
      "email" => email,
      "status" => user["status"].to_s.empty? ? "active" : user["status"],
      "password_digest" => digest.start_with?("$2") ? digest : Passwords.digest(DEMO_PASSWORDS.fetch(email, SecureRandom.hex(12)))
    )
  end

  def default_seed_data
    now = Time.now.utc.iso8601

    admin = {
      "id" => 1,
      "role" => "admin",
      "name" => SUPERADMIN_NAME,
      "email" => SUPERADMIN_EMAIL,
      "phone" => "+91 7204892105",
      "password_digest" => Passwords.digest(SUPERADMIN_PASSWORD),
      "status" => "active",
      "created_at" => now,
      "notes" => "Initial super admin"
    }

    owner1 = {
      "id" => 2,
      "role" => "owner",
      "name" => "Rajesh Kumar",
      "email" => "owner@example.com",
      "phone" => "+91 90000 11111",
      "password_digest" => Passwords.digest("owner123"),
      "status" => "active",
      "created_at" => now,
      "notes" => "Sample Bellandur owner"
    }

    owner2 = {
      "id" => 3,
      "role" => "owner",
      "name" => "Sneha Nair",
      "email" => "owner2@example.com",
      "phone" => "+91 90000 44444",
      "password_digest" => Passwords.digest("owner123"),
      "status" => "active",
      "created_at" => now,
      "notes" => "Whitefield property owner"
    }

    owner3 = {
      "id" => 4,
      "role" => "owner",
      "name" => "Vikram Singh",
      "email" => "owner3@example.com",
      "phone" => "+91 90000 55555",
      "password_digest" => Passwords.digest("owner123"),
      "status" => "active",
      "created_at" => now,
      "notes" => "Urban portfolio owner"
    }

    tenant1 = {
      "id" => 5,
      "role" => "tenant",
      "name" => "Priya Sharma",
      "email" => "tenant@example.com",
      "phone" => "+91 90000 22222",
      "password_digest" => Passwords.digest("tenant123"),
      "status" => "active",
      "created_at" => now,
      "occupation" => "Software Engineer",
      "id_proof" => "KYC verified",
      "emergency_contact" => "Amit Sharma, +91 90000 33333"
    }

    tenant2 = {
      "id" => 6,
      "role" => "tenant",
      "name" => "Aarav Mehta",
      "email" => "tenant2@example.com",
      "phone" => "+91 90000 66666",
      "password_digest" => Passwords.digest("tenant123"),
      "status" => "active",
      "created_at" => now,
      "occupation" => "Product Manager",
      "id_proof" => "KYC verified",
      "emergency_contact" => "Rhea Mehta, +91 90000 77777"
    }

    tenant3 = {
      "id" => 7,
      "role" => "tenant",
      "name" => "Maya Rao",
      "email" => "tenant3@example.com",
      "phone" => "+91 90000 88888",
      "password_digest" => Passwords.digest("tenant123"),
      "status" => "active",
      "created_at" => now,
      "occupation" => "Designer",
      "id_proof" => "KYC verified",
      "emergency_contact" => "Nitin Rao, +91 90000 99999"
    }

    tenant4 = {
      "id" => 8,
      "role" => "tenant",
      "name" => "Shalini Patel",
      "email" => "tenant4@example.com",
      "phone" => "+91 90000 10101",
      "password_digest" => Passwords.digest("tenant123"),
      "status" => "active",
      "created_at" => now,
      "occupation" => "Finance Analyst",
      "id_proof" => "KYC verified",
      "emergency_contact" => "Kunal Patel, +91 90000 20202"
    }

    tenant5 = {
      "id" => 9,
      "role" => "tenant",
      "name" => "Arjun Das",
      "email" => "tenant5@example.com",
      "phone" => "+91 90000 30303",
      "password_digest" => Passwords.digest("tenant123"),
      "status" => "active",
      "created_at" => now,
      "occupation" => "Marketing Executive",
      "id_proof" => "KYC verified",
      "emergency_contact" => "Sonal Das, +91 90000 40404"
    }

    {
      "users" => [admin, owner1, owner2, owner3, tenant1, tenant2, tenant3, tenant4, tenant5],
      "properties" => [
        {
          "id" => 1,
          "title" => "Prestige Lakeside Habitat - A1204",
          "flat_no" => "A-1204",
          "address" => "Prestige Lakeside Habitat, Varthur Main Road",
          "locality" => "Bellandur",
          "city" => "Bangalore",
          "type" => "Apartment",
          "bedrooms" => "2 BHK",
          "bathrooms" => "2",
          "furnishing" => "Fully furnished",
          "rent" => 56000,
          "deposit" => 180000,
          "owner_id" => 2,
          "tenant_id" => 5,
          "status" => "Occupied",
          "lease_start" => "2026-03-01",
          "lease_end" => "2027-02-28",
          "image_url" => "https://images.unsplash.com/photo-1560185127-6ed189bf02f4?auto=format&fit=crop&w=1200&q=80",
          "notes" => "Managed under EaseMyRentals company lease.",
          "created_at" => now
        },
        {
          "id" => 2,
          "title" => "Brigade Lakeside - B308",
          "flat_no" => "B-308",
          "address" => "HSR Layout, Sector 3",
          "locality" => "HSR Layout",
          "city" => "Bangalore",
          "type" => "Apartment",
          "bedrooms" => "2 BHK",
          "bathrooms" => "2",
          "furnishing" => "Semi furnished",
          "rent" => 52000,
          "deposit" => 170000,
          "owner_id" => 2,
          "tenant_id" => 6,
          "status" => "Occupied",
          "lease_start" => "2026-02-01",
          "lease_end" => "2027-01-31",
          "image_url" => "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80",
          "notes" => "New tenant moved in after renovation.",
          "created_at" => now
        },
        {
          "id" => 3,
          "title" => "Sobha Dream Acres - C902",
          "flat_no" => "C-902",
          "address" => "Whitefield Main Road",
          "locality" => "Whitefield",
          "city" => "Bangalore",
          "type" => "Apartment",
          "bedrooms" => "3 BHK",
          "bathrooms" => "3",
          "furnishing" => "Fully furnished",
          "rent" => 73000,
          "deposit" => 220000,
          "owner_id" => 3,
          "tenant_id" => 7,
          "status" => "Occupied",
          "lease_start" => "2026-01-15",
          "lease_end" => "2027-01-14",
          "image_url" => "https://images.unsplash.com/photo-1512917774080-9991f1c4c750?auto=format&fit=crop&w=1200&q=80",
          "notes" => "Owner prefers monthly inspection reports.",
          "created_at" => now
        },
        {
          "id" => 4,
          "title" => "Mantri Greens - D1101",
          "flat_no" => "D-1101",
          "address" => "Koramangala 6th Block",
          "locality" => "Koramangala",
          "city" => "Bangalore",
          "type" => "Apartment",
          "bedrooms" => "3 BHK",
          "bathrooms" => "3",
          "furnishing" => "Fully furnished",
          "rent" => 76000,
          "deposit" => 230000,
          "owner_id" => 4,
          "tenant_id" => 8,
          "status" => "Occupied",
          "lease_start" => "2026-03-15",
          "lease_end" => "2027-03-14",
          "image_url" => "https://images.unsplash.com/photo-1548247412-81a1ab1b49ae?auto=format&fit=crop&w=1200&q=80",
          "notes" => "Popular property with full service package.",
          "created_at" => now
        },
        {
          "id" => 5,
          "title" => "Embassy Lake Terraces - E503",
          "flat_no" => "E-503",
          "address" => "Jayanagar 3rd Block",
          "locality" => "Jayanagar",
          "city" => "Bangalore",
          "type" => "Apartment",
          "bedrooms" => "1 BHK",
          "bathrooms" => "1",
          "furnishing" => "Fully furnished",
          "rent" => 33000,
          "deposit" => 100000,
          "owner_id" => 3,
          "tenant_id" => 9,
          "status" => "Occupied",
          "lease_start" => "2026-04-10",
          "lease_end" => "2027-04-09",
          "image_url" => "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80",
          "notes" => "Compact and well-located single-bedroom flat.",
          "created_at" => now
        },
        {
          "id" => 6,
          "title" => "Prestige Silver Oak - F205",
          "flat_no" => "F-205",
          "address" => "Hebbal Lake Road",
          "locality" => "Hebbal",
          "city" => "Bangalore",
          "type" => "Apartment",
          "bedrooms" => "2 BHK",
          "bathrooms" => "2",
          "furnishing" => "Semi furnished",
          "rent" => 49000,
          "deposit" => 150000,
          "owner_id" => 4,
          "tenant_id" => nil,
          "status" => "Vacant",
          "lease_start" => nil,
          "lease_end" => nil,
          "image_url" => "https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=1200&q=80",
          "notes" => "High-demand vacant unit ready for listing.",
          "created_at" => now
        }
      ],
      "inspections" => [
        {
          "id" => 1,
          "property_id" => 1,
          "scheduled_on" => "2026-04-20",
          "inspector" => "EMR Field Team",
          "status" => "Completed",
          "rating" => "Excellent",
          "summary" => "Kitchen fixtures, appliances, and balcony railing checked. No urgent issues.",
          "photos_count" => 3,
          "image_urls" => [
            "https://images.unsplash.com/photo-1560185127-6ed189bf02f4?auto=format&fit=crop&w=1200&q=80",
            "https://images.unsplash.com/photo-1556911220-bff31c812dba?auto=format&fit=crop&w=1200&q=80",
            "https://images.unsplash.com/photo-1584622650111-993a426fbf0a?auto=format&fit=crop&w=1200&q=80"
          ],
          "created_at" => now
        },
        {
          "id" => 2,
          "property_id" => 2,
          "scheduled_on" => "2026-04-25",
          "inspector" => "EMR Field Team",
          "status" => "Scheduled",
          "rating" => "Pending",
          "summary" => "Quarterly maintenance inspection scheduled.",
          "photos_count" => 0,
          "image_urls" => [],
          "created_at" => now
        }
      ],
      "payments" => [
        {
          "id" => 1,
          "property_id" => 1,
          "tenant_id" => 5,
          "owner_id" => 2,
          "category" => "Rent",
          "due_date" => "2026-04-05",
          "paid_on" => "2026-04-03",
          "amount" => 56000,
          "status" => "Paid",
          "method" => "UPI",
          "reference" => "EMR-APR-1001",
          "notes" => "April rent received and owner payout scheduled.",
          "created_at" => now
        },
        {
          "id" => 2,
          "property_id" => 1,
          "tenant_id" => nil,
          "owner_id" => 2,
          "category" => "Owner payout",
          "due_date" => "2026-04-07",
          "paid_on" => "2026-04-07",
          "amount" => 52000,
          "status" => "Paid",
          "method" => "Bank transfer",
          "reference" => "EMR-OWN-APR-1001",
          "notes" => "Owner monthly payout after service fee.",
          "created_at" => now
        },
        {
          "id" => 3,
          "property_id" => 3,
          "tenant_id" => 7,
          "owner_id" => 3,
          "category" => "Rent",
          "due_date" => "2026-04-10",
          "paid_on" => "2026-04-09",
          "amount" => 73000,
          "status" => "Paid",
          "method" => "NEFT",
          "reference" => "EMR-APR-1002",
          "notes" => "Whitefield rent received.",
          "created_at" => now
        }
      ],
      "assets" => [
        {
          "id" => 1,
          "property_id" => 1,
          "tenant_id" => 5,
          "name" => "Samsung refrigerator",
          "condition" => "Good",
          "quantity" => 1,
          "last_checked_on" => "2026-04-20",
          "notes" => "Double-door fridge, serial noted in inspection report.",
          "created_at" => now
        },
        {
          "id" => 2,
          "property_id" => 1,
          "tenant_id" => 5,
          "name" => "Queen bed with mattress",
          "condition" => "Excellent",
          "quantity" => 2,
          "last_checked_on" => "2026-04-20",
          "notes" => "One in each bedroom.",
          "created_at" => now
        },
        {
          "id" => 3,
          "property_id" => 3,
          "tenant_id" => 7,
          "name" => "LG Washing Machine",
          "condition" => "Good",
          "quantity" => 1,
          "last_checked_on" => "2026-04-18",
          "notes" => "Installed during last inspection.",
          "created_at" => now
        }
      ],
      "listings" => [
        {
          "id" => 1,
          "title" => "Fully Furnished 2 BHK Near Bellandur",
          "locality" => "Bellandur",
          "address" => "Near RMZ Ecospace, Bellandur",
          "type" => "Apartment",
          "bedrooms" => "2 BHK",
          "bathrooms" => "2",
          "furnishing" => "Fully furnished",
          "rent" => 58000,
          "deposit" => 180000,
          "available_from" => "2026-05-10",
          "description" => "Managed home with appliances, sofa, beds, power backup, and quick maintenance support.",
          "status" => "Available",
          "for_ad" => true,
          "for_rent" => true,
          "image_url" => "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=80",
          "created_at" => now
        },
        {
          "id" => 2,
          "title" => "Premier 3 BHK in Whitefield",
          "locality" => "Whitefield",
          "address" => "Near Phoenix Marketcity",
          "type" => "Apartment",
          "bedrooms" => "3 BHK",
          "bathrooms" => "3",
          "furnishing" => "Fully furnished",
          "rent" => 75000,
          "deposit" => 225000,
          "available_from" => "2026-05-15",
          "description" => "Spacious home with all modern amenities and secure gated community.",
          "status" => "Available",
          "for_ad" => true,
          "for_rent" => true,
          "image_url" => "https://images.unsplash.com/photo-1539517079570-3d5e066b9a62?auto=format&fit=crop&w=1200&q=80",
          "created_at" => now
        },
        {
          "id" => 3,
          "title" => "1 BHK Cozy Flat in Jayanagar",
          "locality" => "Jayanagar",
          "address" => "4th T Block, Jayanagar",
          "type" => "Apartment",
          "bedrooms" => "1 BHK",
          "bathrooms" => "1",
          "furnishing" => "Fully furnished",
          "rent" => 34000,
          "deposit" => 105000,
          "available_from" => "2026-05-05",
          "description" => "Cozy home ideal for single professionals and couples.",
          "status" => "Available",
          "for_ad" => false,
          "for_rent" => true,
          "image_url" => "https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?auto=format&fit=crop&w=1200&q=80",
          "created_at" => now
        },
        {
          "id" => 4,
          "title" => "Premium 4 BHK Villa Style Home",
          "locality" => "Sarjapur",
          "address" => "Near Sarjapur Road",
          "type" => "Villa",
          "bedrooms" => "4 BHK",
          "bathrooms" => "4",
          "furnishing" => "Semi furnished",
          "rent" => 125000,
          "deposit" => 360000,
          "available_from" => "2026-06-01",
          "description" => "Large family home with garden, car park, and premium facilities.",
          "status" => "Promoted",
          "for_ad" => true,
          "for_rent" => true,
          "image_url" => "https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=1200&q=80",
          "created_at" => now
        },
        {
          "id" => 5,
          "title" => "Compact Studio on MG Road",
          "locality" => "MG Road",
          "address" => "Near Trinity Metro Station",
          "type" => "Studio",
          "bedrooms" => "1 RK",
          "bathrooms" => "1",
          "furnishing" => "Furnished",
          "rent" => 27000,
          "deposit" => 90000,
          "available_from" => "2026-05-01",
          "description" => "Busy downtown location with easy commute and all utilities included.",
          "status" => "Available",
          "for_ad" => false,
          "for_rent" => true,
          "image_url" => "https://images.unsplash.com/photo-1494526585095-c41746248156?auto=format&fit=crop&w=1200&q=80",
          "created_at" => now
        }
      ],
      "inquiries" => []
    }
  end
end

module Passwords
  module_function

  def digest(password)
    BCrypt::Password.create(password.to_s)
  end

  def valid?(password, digest)
    return false if digest.to_s.empty?

    BCrypt::Password.new(digest).is_password?(password.to_s)
  rescue BCrypt::Errors::InvalidHash
    false
  end
end

class EaseMyRentalsApp
  CONTENT_TYPES = {
    ".html" => "text/html; charset=utf-8",
    ".css" => "text/css; charset=utf-8",
    ".js" => "application/javascript; charset=utf-8",
    ".json" => "application/json; charset=utf-8",
    ".svg" => "image/svg+xml",
    ".png" => "image/png",
    ".jpg" => "image/jpeg",
    ".jpeg" => "image/jpeg"
  }.freeze

  def initialize
    @store = PostgresStore.new
    @sessions = {}
  end

  def call(req, res)
    if req.path.start_with?("/api")
      handle_api(req, res)
    else
      serve_static(req, res)
    end
  rescue ApiError => e
    json(res, e.status, "error" => e.message)
  rescue StandardError => e
    warn "#{e.class}: #{e.message}\n#{e.backtrace&.first(6)&.join("\n")}"
    json(res, 500, "error" => "Something went wrong. Please try again.")
  end

  private

  def handle_api(req, res)
    path = req.path.sub(%r{\A/api}, "")
    method = req.request_method

    case [method, path]
    when ["POST", "/auth/staff-login"], ["POST", "/auth/login-password"]
      password_login(req, res)
    when ["POST", "/login"]
      login(req, res)
    when ["POST", "/logout"]
      logout(res)
    when ["GET", "/me"]
      me(req, res)
    when ["GET", "/dashboard"]
      dashboard(req, res)
    when ["GET", "/public/listings"]
      public_listings(res)
    when ["POST", "/public/inquiries"]
      create_inquiry(req, res)
    when ["POST", "/owner/maintenance-requests"]
      create_maintenance_request(req, res)
    when ["GET", "/owner/notifications"]
      get_owner_notifications(req, res)
    when ["POST", "/owner/notifications/mark-read"]
      mark_notifications_read(req, res)
    when ["POST", "/tenant/maintenance-requests"]
      create_tenant_maintenance_request(req, res)
    when ["GET", "/tenant/notifications"]
      get_tenant_notifications(req, res)
    when ["POST", "/tenant/notifications/mark-read"]
      mark_tenant_notifications_read(req, res)
    when ["PUT", %r{\A/admin/properties/(\d+)\z}]
      update_property(req, res, Regexp.last_match(1).to_i)
    when ["POST", "/admin/properties/add-tenants"]
      add_tenants_to_property(req, res)
    when ["PUT", %r{\A/admin/payments/(\d+)\z}]
      update_resource(req, res, "payments", Regexp.last_match(1).to_i)
    when ["DELETE", %r{\A/admin/payments/(\d+)\z}]
      delete_resource(req, res, "payments", Regexp.last_match(1).to_i)
    when ["PUT", %r{\A/admin/inspections/(\d+)\z}]
      update_resource(req, res, "inspections", Regexp.last_match(1).to_i)
    when ["DELETE", %r{\A/admin/inspections/(\d+)\z}]
      delete_resource(req, res, "inspections", Regexp.last_match(1).to_i)
    when ["PUT", %r{\A/admin/assets/(\d+)\z}]
      update_resource(req, res, "assets", Regexp.last_match(1).to_i)
    when ["DELETE", %r{\A/admin/assets/(\d+)\z}]
      delete_resource(req, res, "assets", Regexp.last_match(1).to_i)
    when ["PUT", %r{\A/admin/listings/(\d+)\z}]
      update_resource(req, res, "listings", Regexp.last_match(1).to_i)
    when ["DELETE", %r{\A/admin/listings/(\d+)\z}]
      delete_resource(req, res, "listings", Regexp.last_match(1).to_i)
    when ["PUT", %r{\A/admin/users/(\d+)\z}]
      update_user(req, res, Regexp.last_match(1).to_i)
    when ["DELETE", %r{\A/admin/users/(\d+)\z}]
      delete_resource(req, res, "users", Regexp.last_match(1).to_i)
    when ["DELETE", %r{\A/admin/inquiries/(\d+)\z}]
      delete_resource(req, res, "inquiries", Regexp.last_match(1).to_i)
    when ["PUT", %r{\A/admin/maintenance_requests/(\d+)\z}]
      update_resource(req, res, "maintenance_requests", Regexp.last_match(1).to_i)
    when ["DELETE", %r{\A/admin/maintenance_requests/(\d+)\z}]
      delete_resource(req, res, "maintenance_requests", Regexp.last_match(1).to_i)
    else
      if method == "POST" && path =~ %r{\A/admin/(users|properties|inspections|payments|assets|listings|maintenance_requests|notifications)\z}
        create_admin_resource(req, res, Regexp.last_match(1))
      else
        raise ApiError.new(404, "API endpoint not found")
      end
    end
  end

  def login(req, res)
    body = json_body(req)
    user = login_user_with_password(body)

    token = SecureRandom.hex(32)
    @sessions[token] = user["id"]
    res["Set-Cookie"] = "#{COOKIE_NAME}=#{token}; Path=/; HttpOnly; SameSite=Lax"
    json(res, 200, "message" => "Login successful.", "user" => public_user(user))
  end

  def password_login(req, res)
    body = json_body(req)
    puts "DEBUG password_login: Received body: #{body.inspect}"
    user = login_user_with_password(body)
    puts "DEBUG password_login: User found: #{user.inspect}"
    json(res, 200, "message" => "Login successful.", "user" => public_user(user))
  end

  def logout(res)
    res["Set-Cookie"] = "#{COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax"
    json(res, 200, "ok" => true)
  end

  def me(req, res)
    user = current_user(req)
    json(res, 200, "user" => (user ? public_user(user) : nil))
  end

  def dashboard(req, res)
    user = require_user(req)
    data = @store.snapshot
    response =
      case user["role"]
      when "admin"
        admin_payload(data, user)
      when "owner"
        owner_payload(data, user)
      when "tenant"
        tenant_payload(data, user)
      else
        raise ApiError.new(403, "Unknown role")
      end

    json(res, 200, response)
  end

  def public_listings(res)
    data = @store.snapshot
    # Get existing listings
    listings = data["listings"].select { |listing| ["Available", "Promoted"].include?(listing["status"]) }
    
    puts "DEBUG public_listings: Found #{listings.length} listings"
    puts "DEBUG data['listings']: #{data['listings'].inspect}"
    
    # Get vacant properties and convert them to listing format
    vacant_properties = data["properties"].select { |property| property["status"] == "Vacant" }
    puts "DEBUG public_listings: Found #{vacant_properties.length} vacant properties"
    property_listings = vacant_properties.map do |property|
      {
        "id" => "property_#{property["id"]}",
        "title" => property["title"],
        "locality" => property["locality"],
        "address" => property["address"],
        "type" => property["type"],
        "bedrooms" => property["bedrooms"],
        "bathrooms" => property["bathrooms"],
        "furnishing" => property["furnishing"],
        "rent" => property["rent"],
        "deposit" => property["deposit"],
        "available_from" => property["lease_end"] || Time.now.strftime("%Y-%m-%d"),
        "description" => "Managed by EaseMyRentals. #{property["notes"]}",
        "status" => "Available",
        "for_ad" => true,
        "for_rent" => true,
        "image_url" => property["image_url"],
        "photo_urls" => property["image_urls"] || [property["image_url"]],
        "video_url" => "",
        "created_at" => property["created_at"]
      }
    end
    
    # Combine and remove duplicates (prefer explicit listings over property listings)
    all_listings = listings + property_listings.reject { |pl| listings.any? { |l| l["title"] == pl["title"] } }
    json(res, 200, "listings" => all_listings)
  end

  def create_inquiry(req, res)
    body = json_body(req)
    required!(body, "name", "phone", "interest")

    inquiry = {
      "name" => clean(body["name"]),
      "phone" => clean(body["phone"]),
      "email" => clean(body["email"]),
      "interest" => clean(body["interest"]),
      "message" => clean(body["message"]),
      "created_at" => Time.now.iso8601
    }
    
    # Add owner-specific fields
    if body["property_type"]
      inquiry["property_type"] = clean(body["property_type"])
    end
    if body["property_size"]
      inquiry["property_size"] = clean(body["property_size"])
    end
    if body["area"]
      inquiry["area"] = clean(body["area"])
    end
    if body["expected_rent"]
      inquiry["expected_rent"] = integer(body["expected_rent"])
    end
    if body["start_date"]
      inquiry["start_date"] = clean(body["start_date"])
    end
    
    # Add tenant-specific fields
    if body["looking_for"]
      inquiry["looking_for"] = clean(body["looking_for"])
    end
    if body["tenant_property_type"]
      inquiry["tenant_property_type"] = clean(body["tenant_property_type"])
    end
    if body["preferred_area"]
      inquiry["preferred_area"] = clean(body["preferred_area"])
    end
    if body["budget"]
      inquiry["budget"] = integer(body["budget"])
    end

    @store.transaction do |data|
      inquiry["id"] = next_id(data, "inquiries")
      data["inquiries"] << inquiry
      
      # Create notification for admin
      admin_users = data["users"].select { |u| u["role"] == "admin" || u["role"] == "superadmin" }
      admin_users.each do |admin|
        # Build notification message based on inquiry type
        notification_title = case inquiry["interest"]
        when "owner" then "New Property Owner Enquiry"
        when "tenant" then "New Tenant Enquiry"
        when "ad" then "New Ad Listing Enquiry"
        when "renovation" then "New Renovation Enquiry"
        else "New Enquiry: #{inquiry["interest"]}"
        end
        
        notification_message = "#{inquiry["name"]} (#{inquiry["phone"]})"
        if inquiry["area"] || inquiry["preferred_area"]
          notification_message += " - Area: #{inquiry["area"] || inquiry["preferred_area"]}"
        end
        
        notification = {
          "id" => next_id(data, "notifications"),
          "user_id" => admin["id"],
          "user_role" => admin["role"],
          "type" => "inquiry",
          "title" => notification_title,
          "message" => notification_message,
          "status" => "unread",
          "created_at" => Time.now.iso8601,
          "data" => { "inquiry_id" => inquiry["id"] }
        }
        data["notifications"] << notification
      end
    end

    json(res, 201, "inquiry" => inquiry)
  end

  def create_maintenance_request(req, res)
    body = json_body(req)
    user = current_user(req)
    raise ApiError.new(401, "Unauthorized") unless user && user["role"] == "owner"
    
    required!(body, "property_id", "title", "description", "priority")
    
    maintenance_request = {
      "id" => nil,
      "property_id" => body["property_id"].to_i,
      "owner_id" => user["id"],
      "title" => clean(body["title"]),
      "description" => clean(body["description"]),
      "priority" => clean(body["priority"]),
      "category" => clean(body["category"]) || "General",
      "status" => "Open",
      "created_at" => Time.now.iso8601,
      "updated_at" => Time.now.iso8601,
      "estimated_cost" => body["estimated_cost"].to_i,
      "scheduled_date" => clean(body["scheduled_date"]),
      "completed_at" => nil,
      "vendor_assigned" => nil,
      "resolution_notes" => nil
    }
    
    @store.transaction do |data|
      maintenance_request["id"] = next_id(data, "maintenance_requests")
      data["maintenance_requests"] ||= []
      data["maintenance_requests"] << maintenance_request
      
      # Create notification for admin
      notification = {
        "id" => next_id(data, "notifications"),
        "user_id" => 1, # Admin
        "user_role" => "admin",
        "title" => "New Maintenance Request",
        "message" => "Owner #{user["name"]} submitted maintenance request: #{maintenance_request["title"]}",
        "type" => "maintenance",
        "status" => "unread",
        "related_id" => maintenance_request["id"],
        "created_at" => Time.now.iso8601
      }
      data["notifications"] ||= []
      data["notifications"] << notification
    end
    
    json(res, 201, "maintenance_request" => maintenance_request)
  end
  
  def get_owner_notifications(req, res)
    user = current_user(req)
    raise ApiError.new(401, "Unauthorized") unless user
    
    data = @store.snapshot
    notifications = data["notifications"]&.select { |n| n["user_id"] == user["id"] && n["user_role"] == user["role"] }&.sort_by { |n| n["created_at"] }&.reverse || []
    
    json(res, 200, "notifications" => notifications.first(20))
  end
  
  def mark_notifications_read(req, res)
    body = json_body(req)
    user = current_user(req)
    raise ApiError.new(401, "Unauthorized") unless user
    
    notification_ids = body["notification_ids"] || []
    
    @store.transaction do |data|
      data["notifications"] ||= []
      data["notifications"].each do |notification|
        if notification["user_id"] == user["id"] && notification["user_role"] == "owner" && notification_ids.include?(notification["id"])
          notification["status"] = "read"
        end
      end
    end
    
    json(res, 200, "message" => "Notifications marked as read")
  end
  
  def create_tenant_maintenance_request(req, res)
    body = json_body(req)
    user = current_user(req)
    raise ApiError.new(401, "Unauthorized") unless user && user["role"] == "tenant"
    
    required!(body, "property_id", "title", "description", "priority")
    
    maintenance_request = {
      "id" => nil,
      "property_id" => body["property_id"].to_i,
      "tenant_id" => user["id"],
      "title" => clean(body["title"]),
      "description" => clean(body["description"]),
      "priority" => clean(body["priority"]),
      "category" => clean(body["category"]) || "General",
      "status" => "Open",
      "created_at" => Time.now.iso8601,
      "updated_at" => Time.now.iso8601,
      "estimated_cost" => body["estimated_cost"].to_i,
      "scheduled_date" => clean(body["scheduled_date"]),
      "completed_at" => nil,
      "vendor_assigned" => nil,
      "resolution_notes" => nil
    }
    
    @store.transaction do |data|
      maintenance_request["id"] = next_id(data, "maintenance_requests")
      data["maintenance_requests"] ||= []
      data["maintenance_requests"] << maintenance_request
      
      # Get property and owner details for notification
      property = data["properties"].find { |p| p["id"] == maintenance_request["property_id"].to_i }
      
      # Create notification for admin
      admin_notification = {
        "id" => next_id(data, "notifications"),
        "user_id" => 1, # Admin
        "user_role" => "admin",
        "title" => "Tenant Maintenance Request",
        "message" => "Tenant #{user["name"]} submitted request: #{maintenance_request["title"]}",
        "type" => "maintenance",
        "status" => "unread",
        "related_id" => maintenance_request["id"],
        "created_at" => Time.now.iso8601
      }
      data["notifications"] << admin_notification
      
      # Create notification for owner if property exists
      if property && property["owner_id"]
        owner_notification = {
          "id" => next_id(data, "notifications"),
          "user_id" => property["owner_id"],
          "user_role" => "owner",
          "title" => "Maintenance Request from Tenant",
          "message" => "Tenant #{user["name"]} reported: #{maintenance_request["title"]}",
          "type" => "maintenance",
          "status" => "unread",
          "related_id" => maintenance_request["id"],
          "created_at" => Time.now.iso8601
        }
        data["notifications"] << owner_notification
      end
    end
    
    json(res, 201, "maintenance_request" => maintenance_request)
  end
  
  def get_tenant_notifications(req, res)
    user = current_user(req)
    raise ApiError.new(401, "Unauthorized") unless user
    
    data = @store.snapshot
    notifications = data["notifications"]&.select { |n| n["user_id"] == user["id"] && n["user_role"] == "tenant" }&.sort_by { |n| n["created_at"] }&.reverse || []
    
    json(res, 200, "notifications" => notifications.first(20))
  end
  
  def mark_tenant_notifications_read(req, res)
    body = json_body(req)
    user = current_user(req)
    raise ApiError.new(401, "Unauthorized") unless user
    
    notification_ids = body["notification_ids"] || []
    
    @store.transaction do |data|
      data["notifications"] ||= []
      data["notifications"].each do |notification|
        if notification["user_id"] == user["id"] && notification["user_role"] == "tenant" && notification_ids.include?(notification["id"])
          notification["status"] = "read"
        end
      end
    end
    
    json(res, 200, "message" => "Notifications marked as read")
  end

  def create_admin_resource(req, res, resource)
    body = json_body(req)
    require_role(req, "admin", body)

    created = @store.transaction do |data|
      case resource
      when "users"
        create_user(data, body)
      when "properties"
        create_property(data, body)
      when "inspections"
        create_inspection(data, body)
      when "payments"
        create_payment(data, body)
      when "assets"
        create_asset(data, body)
      when "listings"
        create_listing(data, body)
      when "maintenance_requests"
        create_maintenance_request_admin(data, body)
      when "notifications"
        create_notification_admin(data, body)
      end
    end

    json(res, 201, resource.singularize => created)
  end

  def create_user(data, body)
    required!(body, "name", "email", "role", "password")
    raise ApiError.new(422, "Password must be at least 8 characters.") if body["password"].to_s.length < 8

    role = clean(body["role"]).downcase
    raise ApiError.new(422, "Role must be owner or tenant") unless ["owner", "tenant"].include?(role)

    email = clean(body["email"]).downcase
    if data["users"].any? { |user| user["email"].to_s.downcase == email }
      raise ApiError.new(422, "A user with this email already exists")
    end

    user = {
      "id" => next_id(data, "users"),
      "role" => role,
      "name" => clean(body["name"]),
      "email" => email,
      "phone" => clean(body["phone"]),
      "password_digest" => Passwords.digest(body["password"]),
      "status" => clean(body["status"], "active"),
      "created_at" => Time.now.iso8601,
      "occupation" => clean(body["occupation"]),
      "id_proof" => clean(body["id_proof"]),
      "emergency_contact" => clean(body["emergency_contact"]),
      "notes" => clean(body["notes"])
    }

    data["users"] << user
    public_user(user)
  end

  def create_property(data, body)
    required!(body, "title", "flat_no", "address", "locality", "owner_id", "rent")
    owner_id = integer(body["owner_id"])
    tenant_id = optional_integer(body["tenant_id"])
    ensure_user!(data, owner_id, "owner")
    ensure_user!(data, tenant_id, "tenant") if tenant_id

    image_urls = media_urls_from_body(body, "image_urls", "uploaded_image_urls")
    
    # Parse room_tenants from form (for room-wise rent)
    room_tenants = parse_room_tenants(body, data)

    # Calculate lease end based on agreement duration
    lease_start = clean(body["lease_start"])
    agreement_duration = integer(body["agreement_duration_years"]) || 1
    lease_end = clean(body["lease_end"])
    
    if lease_start && !lease_end && agreement_duration
      begin
        start_date = Date.parse(lease_start)
        lease_end = (start_date >> (agreement_duration * 12)).iso8601
      rescue
        lease_end = nil
      end
    end
    
    property = {
      "id" => next_id(data, "properties"),
      "title" => clean(body["title"]),
      "flat_no" => clean(body["flat_no"]),
      "address" => clean(body["address"]),
      "locality" => clean(body["locality"]),
      "city" => clean(body["city"], "Bangalore"),
      "type" => clean(body["type"], "Apartment"),
      "bedrooms" => clean(body["bedrooms"]),
      "bathrooms" => clean(body["bathrooms"]),
      "furnishing" => clean(body["furnishing"], "Fully furnished"),
      "rent" => integer(body["rent"]),
      "deposit" => integer(body["deposit"]),
      "owner_id" => owner_id,
      "tenant_id" => tenant_id,
      "room_tenants" => room_tenants,
      "status" => clean(body["status"], (tenant_id || room_tenants.any?) ? "Occupied" : "Vacant"),
      "lease_start" => lease_start,
      "lease_end" => lease_end,
      "agreement_duration_years" => agreement_duration,
      "annual_hike_percent" => integer(body["annual_hike_percent"]) || 5,
      "image_url" => image_urls.first || "https://images.unsplash.com/photo-1560185127-6ed189bf02f4?auto=format&fit=crop&w=1200&q=80",
      "image_urls" => image_urls,
      "notes" => clean(body["notes"]),
      "created_at" => Time.now.iso8601
    }

    data["properties"] << property
    property
  end
  
  def parse_room_tenants(body, data)
    tenants = []
    
    # Check if room assignments are provided
    return tenants unless body["room_tenants"]
    
    room_data = body["room_tenants"]
    if room_data.is_a?(String)
      begin
        room_data = JSON.parse(room_data)
      rescue JSON::ParserError
        return tenants
      end
    end
    
    room_data.each do |room|
      next unless room["tenant_id"].to_i > 0
      
      tenant = data["users"].find { |u| u["id"] == room["tenant_id"].to_i && u["role"] == "tenant" }
      next unless tenant
      
      tenants << {
        "room" => clean(room["room"]) || "Room #{tenants.length + 1}",
        "tenant_id" => room["tenant_id"].to_i,
        "tenant_name" => tenant["name"],
        "rent" => integer(room["rent"]),
        "deposit" => integer(room["deposit"]),
        "lease_start" => clean(room["lease_start"]),
        "lease_end" => clean(room["lease_end"]),
        "status" => clean(room["status"]) || "Active"
      }
    end
    
    tenants
  end
  
  def update_property(req, res, property_id)
    body = json_body(req)
    user = current_user(req)
    raise ApiError.new(401, "Unauthorized") unless user && user["role"] == "admin"
    
    @store.transaction do |data|
      property = data["properties"].find { |p| p["id"] == property_id }
      raise ApiError.new(404, "Property not found") unless property
      
      # Update basic fields if provided
      property["title"] = clean(body["title"]) if body["title"]
      property["flat_no"] = clean(body["flat_no"]) if body["flat_no"]
      property["address"] = clean(body["address"]) if body["address"]
      property["locality"] = clean(body["locality"]) if body["locality"]
      property["city"] = clean(body["city"]) if body["city"]
      property["rent"] = integer(body["rent"]) if body["rent"]
      property["deposit"] = integer(body["deposit"]) if body["deposit"]
      property["status"] = clean(body["status"]) if body["status"]
      property["notes"] = clean(body["notes"]) if body["notes"]
      
      # Update agreement fields
      property["lease_start"] = clean(body["lease_start"]) if body["lease_start"]
      property["agreement_duration_years"] = integer(body["agreement_duration_years"]) if body["agreement_duration_years"]
      property["annual_hike_percent"] = integer(body["annual_hike_percent"]) if body["annual_hike_percent"]
      
      # Recalculate lease_end based on duration
      if property["lease_start"] && property["agreement_duration_years"]
        begin
          start_date = Date.parse(property["lease_start"])
          property["lease_end"] = (start_date >> (property["agreement_duration_years"] * 12)).iso8601
        rescue
          # keep existing lease_end if parsing fails
        end
      end
      
      # Update room tenants if provided
      if body["room_tenants"]
        property["room_tenants"] = parse_room_tenants(body, data)
      end
      
      # Update owner if provided
      if body["owner_id"]
        owner_id = integer(body["owner_id"])
        ensure_user!(data, owner_id, "owner")
        property["owner_id"] = owner_id
      end
      
      # Update tenant_id based on room_tenants or direct assignment
      if body["tenant_id"]
        property["tenant_id"] = optional_integer(body["tenant_id"])
      end
      
      # Update status based on occupancy
      if property["room_tenants"]&.any? || property["tenant_id"]
        property["status"] = "Occupied"
      else
        property["status"] = "Vacant"
      end
      
      property["updated_at"] = Time.now.iso8601
      json(res, 200, "property" => property)
    end
  end
  
  def add_tenants_to_property(req, res)
    body = json_body(req)
    user = current_user(req)
    raise ApiError.new(401, "Unauthorized") unless user && user["role"] == "admin"
    
    required!(body, "property_id", "room_tenants")
    property_id = integer(body["property_id"])
    
    @store.transaction do |data|
      property = data["properties"].find { |p| p["id"] == property_id }
      raise ApiError.new(404, "Property not found") unless property
      
      # Parse new room tenants
      new_tenants = parse_room_tenants(body, data)
      
      # Merge with existing room tenants (avoid duplicates by room name)
      existing_rooms = (property["room_tenants"] || []).map { |rt| rt["room"] }
      
      new_tenants.each do |nt|
        # Remove existing tenant for same room if exists
        property["room_tenants"] ||= []
        property["room_tenants"].delete_if { |rt| rt["room"] == nt["room"] }
        property["room_tenants"] << nt
      end
      
      property["status"] = "Occupied"
      property["updated_at"] = Time.now.iso8601
      
      json(res, 200, "property" => property, "added_tenants" => new_tenants.length)
    end
  end
  
  def update_resource(req, res, resource_type, id)
    body = json_body(req)
    user = current_user(req)
    raise ApiError.new(401, "Unauthorized") unless user && user["role"] == "admin"
    
    @store.transaction do |data|
      collection = data[resource_type]
      raise ApiError.new(404, "Resource type not found") unless collection
      
      item = collection.find { |r| r["id"] == id }
      raise ApiError.new(404, "#{resource_type.capitalize} not found") unless item
      
      # Update allowed fields (excluding id and created_at)
      body.each do |key, value|
        next if ["id", "created_at"].include?(key)
        item[key] = value.is_a?(String) ? clean(value) : value
      end
      
      item["updated_at"] = Time.now.iso8601
      json(res, 200, resource_type.singularize => item)
    end
  end
  
  def delete_resource(req, res, resource_type, id)
    user = current_user(req)
    raise ApiError.new(401, "Unauthorized") unless user && user["role"] == "admin"
    
    @store.transaction do |data|
      collection = data[resource_type]
      raise ApiError.new(404, "Resource type not found") unless collection
      
      index = collection.find_index { |r| r["id"] == id }
      raise ApiError.new(404, "#{resource_type.capitalize} not found") unless index
      
      deleted = collection.delete_at(index)
      json(res, 200, "deleted" => true, "id" => id, "type" => resource_type)
    end
  end
  
  def update_user(req, res, user_id)
    body = json_body(req)
    user = current_user(req)
    raise ApiError.new(401, "Unauthorized") unless user && user["role"] == "admin"
    
    @store.transaction do |data|
      user_record = data["users"].find { |u| u["id"] == user_id }
      raise ApiError.new(404, "User not found") unless user_record
      
      # Update allowed fields
      user_record["name"] = clean(body["name"]) if body["name"]
      user_record["email"] = clean(body["email"]) if body["email"]
      user_record["phone"] = clean(body["phone"]) if body["phone"]
      user_record["status"] = clean(body["status"]) if body["status"]
      user_record["notes"] = clean(body["notes"]) if body["notes"]
      
      # Only update password if provided
      if body["password"] && !body["password"].empty?
        user_record["password_hash"] = hash_password(body["password"])
      end
      
      user_record["updated_at"] = Time.now.iso8601
      json(res, 200, "user" => public_user(user_record))
    end
  end

  def create_inspection(data, body)
    required!(body, "property_id", "scheduled_on", "status", "summary")
    property = ensure_property!(data, integer(body["property_id"]))
    image_urls = media_urls_from_body(body, "image_urls", "uploaded_image_urls")
    photos_count = image_urls.empty? ? integer(body["photos_count"]) : image_urls.length

    inspection = {
      "id" => next_id(data, "inspections"),
      "property_id" => property["id"],
      "scheduled_on" => clean(body["scheduled_on"]),
      "inspector" => clean(body["inspector"], "EMR Field Team"),
      "status" => clean(body["status"], "Scheduled"),
      "rating" => clean(body["rating"]),
      "summary" => clean(body["summary"]),
      "photos_count" => photos_count,
      "image_urls" => image_urls,
      "created_at" => Time.now.iso8601
    }

    data["inspections"] << inspection
    inspection
  end

  def create_payment(data, body)
    required!(body, "property_id", "category", "due_date", "amount", "status")
    property = ensure_property!(data, integer(body["property_id"]))
    category = clean(body["category"], "Rent")
    tenant_id = if category.downcase == "owner payout"
      optional_integer(body["tenant_id"])
    else
      optional_integer(body["tenant_id"]) || property["tenant_id"]
    end
    owner_id = optional_integer(body["owner_id"]) || property["owner_id"]

    ensure_user!(data, tenant_id, "tenant") if tenant_id
    ensure_user!(data, owner_id, "owner") if owner_id

    payment = {
      "id" => next_id(data, "payments"),
      "property_id" => property["id"],
      "tenant_id" => tenant_id,
      "owner_id" => owner_id,
      "category" => category,
      "due_date" => clean(body["due_date"]),
      "paid_on" => clean(body["paid_on"]),
      "amount" => integer(body["amount"]),
      "status" => clean(body["status"], "Due"),
      "method" => clean(body["method"]),
      "reference" => clean(body["reference"]),
      "notes" => clean(body["notes"]),
      "created_at" => Time.now.iso8601
    }

    data["payments"] << payment
    payment
  end

  def create_asset(data, body)
    required!(body, "property_id", "name", "condition", "quantity")
    property = ensure_property!(data, integer(body["property_id"]))
    tenant_id = optional_integer(body["tenant_id"]) || property["tenant_id"]
    ensure_user!(data, tenant_id, "tenant") if tenant_id

    asset = {
      "id" => next_id(data, "assets"),
      "property_id" => property["id"],
      "tenant_id" => tenant_id,
      "name" => clean(body["name"]),
      "condition" => clean(body["condition"]),
      "quantity" => integer(body["quantity"]),
      "last_checked_on" => clean(body["last_checked_on"]),
      "notes" => clean(body["notes"]),
      "created_at" => Time.now.iso8601
    }

    data["assets"] << asset
    asset
  end

  def create_listing(data, body)
    required!(body, "title", "locality", "rent", "description")
    fallback_image = "https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?auto=format&fit=crop&w=1200&q=80"
    image_url = clean(body["image_url"])
    photo_urls = media_urls_from_body(body, "image_urls", "uploaded_image_urls")
    photo_urls.unshift(image_url) unless image_url.empty? || photo_urls.include?(image_url)
    photo_urls << fallback_image if photo_urls.empty?
    video_url = clean(body["video_url"])
    uploaded_video_url = clean(body["uploaded_video_url"])
    video_url = uploaded_video_url if video_url.empty?

    listing = {
      "id" => next_id(data, "listings"),
      "title" => clean(body["title"]),
      "locality" => clean(body["locality"]),
      "address" => clean(body["address"]),
      "type" => clean(body["type"], "Apartment"),
      "bedrooms" => clean(body["bedrooms"]),
      "bathrooms" => clean(body["bathrooms"]),
      "furnishing" => clean(body["furnishing"], "Fully furnished"),
      "rent" => integer(body["rent"]),
      "deposit" => integer(body["deposit"]),
      "available_from" => clean(body["available_from"]),
      "description" => clean(body["description"]),
      "status" => clean(body["status"], "Available"),
      "for_ad" => boolean(body["for_ad"], true),
      "for_rent" => boolean(body["for_rent"], true),
      "image_url" => photo_urls.first,
      "photo_urls" => photo_urls,
      "video_url" => video_url,
      "created_at" => Time.now.iso8601
    }

    data["listings"] << listing
    listing
  end

  def create_maintenance_request_admin(data, body)
    required!(body, "property_id", "title", "description", "priority")
    
    property = data["properties"].find { |p| p["id"] == body["property_id"].to_i }
    raise ApiError.new(422, "Property not found") unless property
    
    maintenance_request = {
      "id" => next_id(data, "maintenance_requests"),
      "property_id" => body["property_id"].to_i,
      "owner_id" => property["owner_id"],
      "title" => clean(body["title"]),
      "description" => clean(body["description"]),
      "priority" => clean(body["priority"]),
      "category" => clean(body["category"]) || "General",
      "status" => clean(body["status"]) || "Open",
      "created_at" => Time.now.iso8601,
      "updated_at" => Time.now.iso8601,
      "estimated_cost" => body["estimated_cost"].to_i,
      "scheduled_date" => clean(body["scheduled_date"]),
      "completed_at" => nil,
      "vendor_assigned" => clean(body["vendor_assigned"]),
      "resolution_notes" => nil
    }
    
    data["maintenance_requests"] ||= []
    data["maintenance_requests"] << maintenance_request
    
    # Create notification for owner
    owner = data["users"].find { |u| u["id"] == property["owner_id"] }
    if owner
      notification = {
        "id" => next_id(data, "notifications"),
        "user_id" => owner["id"],
        "user_role" => "owner",
        "title" => "New Maintenance Request Created",
        "message" => "A maintenance request '#{maintenance_request["title"]}' has been created for your property #{property["title"]}",
        "type" => "maintenance",
        "status" => "unread",
        "related_id" => maintenance_request["id"],
        "created_at" => Time.now.iso8601
      }
      data["notifications"] ||= []
      data["notifications"] << notification
    end
    
    maintenance_request
  end
  
  def create_notification_admin(data, body)
    required!(body, "user_id", "user_role", "title", "message")
    
    notification = {
      "id" => next_id(data, "notifications"),
      "user_id" => body["user_id"].to_i,
      "user_role" => clean(body["user_role"]),
      "title" => clean(body["title"]),
      "message" => clean(body["message"]),
      "type" => clean(body["type"]) || "general",
      "status" => "unread",
      "related_id" => body["related_id"],
      "created_at" => Time.now.iso8601
    }
    
    data["notifications"] ||= []
    data["notifications"] << notification
    notification
  end

  def admin_payload(data, user)
    {
      "user" => public_user(user),
      "role" => "admin",
      "stats" => {
        "owners" => data["users"].count { |candidate| candidate["role"] == "owner" },
        "tenants" => data["users"].count { |candidate| candidate["role"] == "tenant" },
        "properties" => data["properties"].length,
        "due_payments" => data["payments"].count { |payment| payment["status"] != "Paid" },
        "active_listings" => data["listings"].count { |listing| ["Available", "Promoted"].include?(listing["status"]) },
        "open_maintenance" => (data["maintenance_requests"] || []).count { |r| ["Open", "In Progress"].include?(r["status"]) }
      },
      "users" => data["users"].map { |candidate| public_user(candidate) },
      "properties" => enrich_properties(data, data["properties"]),
      "inspections" => enrich_records(data, data["inspections"]),
      "payments" => enrich_records(data, data["payments"]),
      "assets" => enrich_records(data, data["assets"]),
      "listings" => data["listings"],
      "maintenance_requests" => enrich_records(data, (data["maintenance_requests"] || []).sort_by { |r| r["created_at"] }.reverse),
      "inquiries" => data["inquiries"].last(20).reverse
    }
  end

  def owner_payload(data, user)
    properties = data["properties"].select { |property| property["owner_id"] == user["id"] }
    property_ids = properties.map { |property| property["id"] }
    owner_payments = data["payments"].select { |record| record["owner_id"] == user["id"] || property_ids.include?(record["property_id"]) }
    
    # Calculate room-wise stats (without tenant names)
    total_occupied_rooms = properties.sum { |p| (p["room_tenants"] || []).count { |rt| rt["status"] == "Active" } }
    total_room_rent = properties.sum { |p| (p["room_tenants"] || []).sum { |rt| rt["rent"].to_i } }

    # Calculate monthly payout analytics
    monthly_analytics = calculate_owner_monthly_analytics(owner_payments, properties)
    
    # Get maintenance requests for owner's properties
    maintenance_requests = data["maintenance_requests"]&.select { |record| property_ids.include?(record["property_id"]) } || []
    
    # Get owner notifications
    notifications = data["notifications"]&.select { |record| record["user_id"] == user["id"] && record["user_role"] == "owner" }&.sort_by { |n| n["created_at"] }&.reverse&.first(10) || []

    {
      "user" => public_user(user),
      "role" => "owner",
      "stats" => {
        "properties" => properties.length,
        "occupied" => properties.count { |property| property["tenant_id"] || (property["room_tenants"]&.any?) },
        "vacant" => properties.count { |property| !property["tenant_id"] && !(property["room_tenants"]&.any?) },
        "total_units" => total_occupied_rooms + properties.count { |p| p["tenant_id"] },
        "inspections" => data["inspections"].count { |record| property_ids.include?(record["property_id"]) },
        "payments" => owner_payments.count,
        "total_rent_collected" => owner_payments.select { |p| p["category"] == "Rent" && p["status"] == "Paid" }.sum { |p| p["amount"].to_i },
        "total_room_rent" => total_room_rent,
        "open_maintenance" => (data["maintenance_requests"] || []).count { |r| property_ids.include?(r["property_id"]) && ["Open", "In Progress"].include?(r["status"]) }
      },
      "properties" => enrich_properties_for_owner(properties),
      "inspections" => enrich_records(data, data["inspections"].select { |record| property_ids.include?(record["property_id"]) }),
      "payments" => enrich_records(data, owner_payments),
      "monthly_analytics" => monthly_analytics,
      "maintenance_requests" => enrich_records(data, maintenance_requests),
      "notifications" => notifications
    }
  end
  
  def enrich_properties_for_owner(properties)
    properties.map do |property|
      # Only show occupancy status, not tenant details
      # Count occupied units without revealing tenant identities
      occupied_units = if property["room_tenants"]&.any?
        property["room_tenants"].count { |rt| rt["status"] == "Active" }
      elsif property["tenant_id"]
        1
      else
        0
      end
      
      # Calculate current rent without tenant-specific details
      current_rent = calculate_current_rent(property)
      total_room_rent = (property["room_tenants"] || []).sum { |rt| rt["current_rent"] || rt["rent"].to_i }
      
      {
        "id" => property["id"],
        "title" => property["title"],
        "flat_no" => property["flat_no"],
        "address" => property["address"],
        "locality" => property["locality"],
        "city" => property["city"],
        "type" => property["type"],
        "bedrooms" => property["bedrooms"],
        "bathrooms" => property["bathrooms"],
        "furnishing" => property["furnishing"],
        "rent" => property["rent"],
        "deposit" => property["deposit"],
        "current_base_rent" => current_rent,
        "total_current_rent" => total_room_rent > 0 ? total_room_rent : current_rent,
        "status" => property["status"],
        "lease_start" => property["lease_start"],
        "lease_end" => property["lease_end"],
        "years_completed" => years_completed(property["lease_start"]),
        "annual_hike_percent" => property["annual_hike_percent"],
        "image_url" => property["image_url"],
        "image_urls" => property["image_urls"],
        "notes" => property["notes"],
        "occupied_units" => occupied_units,
        "occupancy_status" => occupied_units > 0 ? "Occupied" : "Vacant",
        # No tenant_id, no room_tenants details, no tenant names
      }
    end
  end

  def calculate_owner_monthly_analytics(payments, properties)
    # Group payments by month
    rent_by_month = Hash.new(0)
    payouts_by_month = Hash.new(0)
    
    payments.each do |payment|
      next unless payment["due_date"]
      month_key = payment["due_date"][0..6] # YYYY-MM format
      
      if payment["category"] == "Rent" && payment["status"] == "Paid"
        rent_by_month[month_key] += payment["amount"].to_i
      elsif payment["category"] == "Owner payout"
        payouts_by_month[month_key] += payment["amount"].to_i
      end
    end
    
    # Get last 6 months
    months = []
    5.downto(0) do |i|
      date = Date.today << i
      month_key = date.strftime("%Y-%m")
      months << {
        "month" => date.strftime("%b %Y"),
        "rent_collected" => rent_by_month[month_key],
        "owner_payout" => payouts_by_month[month_key],
        "net_payout" => payouts_by_month[month_key] > 0 ? payouts_by_month[month_key] : rent_by_month[month_key]
      }
    end
    
    months
  end

  def tenant_payload(data, user)
    # Find properties where tenant is assigned directly OR through room_tenants
    properties = data["properties"].select do |property| 
      property["tenant_id"] == user["id"] || 
      (property["room_tenants"] || []).any? { |rt| rt["tenant_id"] == user["id"] }
    end
    property_ids = properties.map { |property| property["id"] }
    
    # Find room assignments for this tenant
    room_assignments = []
    properties.each do |property|
      (property["room_tenants"] || []).each do |rt|
        if rt["tenant_id"] == user["id"]
          room_assignments << {
            "property_id" => property["id"],
            "property_title" => property["title"],
            "room" => rt["room"],
            "rent" => rt["rent"],
            "deposit" => rt["deposit"],
            "lease_start" => rt["lease_start"],
            "lease_end" => rt["lease_end"],
            "status" => rt["status"]
          }
        end
      end
    end
    
    # Get tenant's maintenance requests
    maintenance_requests = data["maintenance_requests"]&.select { |record| record["tenant_id"] == user["id"] || property_ids.include?(record["property_id"]) } || []
    
    # Get tenant notifications
    notifications = data["notifications"]&.select { |record| record["user_id"] == user["id"] && record["user_role"] == "tenant" }&.sort_by { |n| n["created_at"] }&.reverse&.first(10) || []
    
    # Calculate payment summary
    tenant_payments = data["payments"].select { |record| record["tenant_id"] == user["id"] }
    total_due = tenant_payments.select { |p| p["status"] == "Due" || p["status"] == "Overdue" }.sum { |p| p["amount"].to_i }
    total_paid = tenant_payments.select { |p| p["status"] == "Paid" }.sum { |p| p["amount"].to_i }
    
    # Calculate room rent total
    total_room_rent = room_assignments.sum { |ra| ra["rent"].to_i }

    {
      "user" => public_user(user),
      "role" => "tenant",
      "stats" => {
        "properties" => properties.length,
        "room_assignments" => room_assignments.length,
        "assets" => data["assets"].count { |record| record["tenant_id"] == user["id"] || property_ids.include?(record["property_id"]) },
        "inspections" => data["inspections"].count { |record| property_ids.include?(record["property_id"]) },
        "payments" => tenant_payments.count,
        "open_payments" => tenant_payments.count { |record| record["status"] != "Paid" },
        "total_due" => total_due,
        "total_paid" => total_paid,
        "total_room_rent" => total_room_rent,
        "maintenance_requests" => maintenance_requests.count,
        "open_maintenance" => maintenance_requests.count { |r| r["status"] == "Open" || r["status"] == "In Progress" }
      },
      "properties" => enrich_properties(data, properties),
      "room_assignments" => room_assignments,
      "inspections" => enrich_records(data, data["inspections"].select { |record| property_ids.include?(record["property_id"]) }),
      "assets" => enrich_records(data, data["assets"].select { |record| record["tenant_id"] == user["id"] || property_ids.include?(record["property_id"]) }),
      "payments" => enrich_records(data, tenant_payments),
      "maintenance_requests" => enrich_records(data, maintenance_requests),
      "notifications" => notifications
    }
  end

  def enrich_properties(data, properties)
    properties.map do |property|
      # Enrich room_tenants with current tenant names
      room_tenants = (property["room_tenants"] || []).map do |room|
        tenant = data["users"].find { |u| u["id"] == room["tenant_id"] }
        room.merge("tenant_name" => tenant ? tenant["name"] : "Unknown")
      end
      
      # Calculate current rent with annual hikes
      current_base_rent = calculate_current_rent(property)
      
      # Calculate room-wise current rents
      room_tenants_with_current_rent = room_tenants.map do |rt|
        rt.merge("current_rent" => calculate_room_current_rent(property, rt))
      end
      
      # Create tenant summary for display
      tenant_summary = if room_tenants.any?
        "#{room_tenants.length} tenants (#{room_tenants.map { |r| r["room"] }.join(", ")})"
      elsif property["tenant_id"]
        user_name(data, property["tenant_id"])
      else
        "Vacant"
      end
      
      property.merge(
        "owner_name" => user_name(data, property["owner_id"]),
        "tenant_name" => user_name(data, property["tenant_id"]),
        "room_tenants" => room_tenants_with_current_rent,
        "tenant_summary" => tenant_summary,
        "total_room_rent" => room_tenants.sum { |r| r["rent"].to_i },
        "total_current_rent" => room_tenants_with_current_rent.sum { |r| r["current_rent"].to_i },
        "current_base_rent" => current_base_rent,
        "occupied_rooms" => room_tenants.count { |r| r["status"] == "Active" },
        "years_completed" => years_completed(property["lease_start"]),
        "next_hike_date" => next_hike_date(property["lease_start"], property["agreement_duration_years"])
      )
    end
  end
  
  def calculate_current_rent(property)
    base_rent = property["rent"].to_i
    return base_rent if base_rent == 0
    
    lease_start = property["lease_start"]
    hike_percent = property["annual_hike_percent"].to_i
    return base_rent if lease_start.nil? || hike_percent == 0
    
    begin
      start_date = Date.parse(lease_start)
      years_passed = ((Date.today - start_date).to_i / 365.25).to_i
      current_rent = base_rent * ((1 + hike_percent / 100.0) ** years_passed)
      current_rent.round
    rescue
      base_rent
    end
  end
  
  def calculate_room_current_rent(property, room_tenant)
    base_rent = room_tenant["rent"].to_i
    return base_rent if base_rent == 0
    
    lease_start = room_tenant["lease_start"] || property["lease_start"]
    hike_percent = property["annual_hike_percent"].to_i
    return base_rent if lease_start.nil? || hike_percent == 0
    
    begin
      start_date = Date.parse(lease_start)
      years_passed = ((Date.today - start_date).to_i / 365.25).to_i
      current_rent = base_rent * ((1 + hike_percent / 100.0) ** years_passed)
      current_rent.round
    rescue
      base_rent
    end
  end
  
  def years_completed(lease_start)
    return 0 if lease_start.nil?
    begin
      start_date = Date.parse(lease_start)
      ((Date.today - start_date).to_i / 365.25).to_i
    rescue
      0
    end
  end
  
  def next_hike_date(lease_start, agreement_duration_years)
    return nil if lease_start.nil?
    begin
      start_date = Date.parse(lease_start)
      years_passed = ((Date.today - start_date).to_i / 365.25).to_i
      next_hike = start_date >> ((years_passed + 1) * 12)
      next_hike.iso8601
    rescue
      nil
    end
  end

  def enrich_records(data, records)
    records.map do |record|
      property = data["properties"].find { |candidate| candidate["id"] == record["property_id"] }
      owner_id = record.key?("owner_id") ? record["owner_id"] : (property && property["owner_id"])
      tenant_id = record.key?("tenant_id") ? record["tenant_id"] : (property && property["tenant_id"])
      record.merge(
        "property_title" => property ? property["title"] : "Unassigned",
        "owner_name" => user_name(data, owner_id),
        "tenant_name" => user_name(data, tenant_id)
      )
    end
  end

  def user_name(data, id)
    return nil unless id

    user = data["users"].find { |candidate| candidate["id"] == id }
    user && user["name"]
  end

  def public_user(user)
    user.reject { |key, _value| key == "password_digest" }.merge(
      "identifier" => user["email"],
      "isAdmin" => user["role"] == "admin"
    )
  end

  def login_user_with_password(body)
    email = clean(body["email"]).downcase
    role = clean(body["role"]).downcase
    password = body.fetch("password", "").to_s
    user = user_by_identifier(email)

    unless user && user["status"] == "active" && Passwords.valid?(password, user["password_digest"])
      raise ApiError.new(401, "Invalid email or password")
    end

    if !role.empty? && role != user["role"]
      raise ApiError.new(403, "This email is not registered as #{role}.")
    end

    user
  end

  def current_user(req, payload = nil)
    token = cookie_value(req, COOKIE_NAME)
    user_id = token && @sessions[token]
    user = user_by_id(user_id) if user_id
    return user if user

    identifier = payload&.fetch("identifier", nil) || request_param(req, "identifier")
    user_by_identifier(identifier)
  end

  def require_user(req, payload = nil)
    current_user(req, payload) || raise(ApiError.new(401, "Please log in"))
  end

  def require_role(req, role, payload = nil)
    user = require_user(req, payload)
    raise ApiError.new(403, "You do not have access to this action") unless user["role"] == role

    user
  end

  def user_by_id(id)
    return nil unless id

    @store.snapshot["users"].find { |user| user["id"] == id.to_i && user["status"] == "active" }
  end

  def user_by_identifier(identifier)
    normalized = identifier.to_s.strip.downcase
    return nil if normalized.empty?

    @store.snapshot["users"].find do |user|
      user["email"].to_s.downcase == normalized || user["id"].to_s == normalized
    end
  end

  def request_param(req, name)
    req.query[name].to_s
  end

  def cookie_value(req, name)
    cookie = req.cookies.find { |candidate| candidate.name == name }
    cookie && cookie.value
  end

  def json_body(req)
    return {} if req.body.to_s.strip.empty?

    JSON.parse(req.body)
  rescue JSON::ParserError
    raise ApiError.new(400, "Invalid JSON payload")
  end

  def json(res, status, payload)
    res.status = status
    res["Content-Type"] = "application/json; charset=utf-8"
    res.body = JSON.generate(payload)
  end

  def serve_static(req, res)
    request_path = req.path == "/" ? "/index.html" : req.path
    relative = request_path.sub(%r{\A/+}, "")
    candidate = File.expand_path(relative, PUBLIC_DIR)
    public_root = File.expand_path(PUBLIC_DIR)

    unless candidate.start_with?(public_root) && File.file?(candidate)
      candidate = File.join(PUBLIC_DIR, "index.html")
    end

    res.status = 200
    res["Content-Type"] = CONTENT_TYPES.fetch(File.extname(candidate), "application/octet-stream")
    res.body = File.binread(candidate)
  end

  def required!(body, *fields)
    missing = fields.select { |field| body[field].to_s.strip.empty? }
    raise ApiError.new(422, "Missing required field: #{missing.join(", ")}") unless missing.empty?
  end

  def ensure_user!(data, id, role)
    user = data["users"].find { |candidate| candidate["id"] == id && candidate["role"] == role }
    raise ApiError.new(422, "#{role.capitalize} not found") unless user

    user
  end

  def ensure_property!(data, id)
    property = data["properties"].find { |candidate| candidate["id"] == id }
    raise ApiError.new(422, "Property not found") unless property

    property
  end

  def next_id(data, collection)
    current = data[collection].map { |record| record["id"].to_i }.max || 0
    current + 1
  end

  def clean(value, fallback = "")
    text = value.to_s.strip
    text.empty? ? fallback : text
  end

  def integer(value)
    value.to_s.gsub(/[^\d]/, "").to_i
  end

  def optional_integer(value)
    text = value.to_s.strip
    text.empty? ? nil : integer(text)
  end

  def boolean(value, fallback)
    return fallback if value.nil? || value.to_s.empty?

    ["true", "1", "yes", "on"].include?(value.to_s.downcase)
  end

  def media_urls_from_body(body, text_key, upload_key)
    text_urls = body[text_key].to_s.split(/[\n,]/).map(&:strip)
    uploaded_urls = Array(body[upload_key]).map(&:to_s).map(&:strip)

    (text_urls + uploaded_urls).reject(&:empty?).uniq
  end
end

class String
  def singularize
    sub(/ies\z/, "y").sub(/s\z/, "")
  end
end

app = EaseMyRentalsApp.new
port = ENV.fetch("PORT", "8000").to_i
log_level_name = ENV.fetch("LOG_LEVEL", "info").upcase
log_level = WEBrick::Log.const_defined?(log_level_name) ? WEBrick::Log.const_get(log_level_name) : WEBrick::Log::INFO

server = WEBrick::HTTPServer.new(
  BindAddress: ENV.fetch("BIND_ADDRESS", ENV.fetch("HOST", "127.0.0.1")),
  Port: port,
  AccessLog: [],
  Logger: WEBrick::Log.new($stdout, log_level)
)

server.mount_proc("/") { |req, res| app.call(req, res) }

trap("INT") { server.shutdown }
trap("TERM") { server.shutdown }

puts "EaseMyRentals running at http://127.0.0.1:#{port}"
server.start
