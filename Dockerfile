FROM ruby:3.3.10-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends build-essential libpq-dev \
  && rm -rf /var/lib/apt/lists/*

COPY Gemfile ./

RUN bundle install

COPY . .

ENV PORT=8000
ENV BIND_ADDRESS=0.0.0.0

EXPOSE 8000

CMD ["ruby", "server.rb"]
