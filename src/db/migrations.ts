import { getDb } from './index.js';

export async function runMigrations(): Promise<void> {
  const sql = getDb();

  console.log('Running database migrations...');

  console.log('1. CREATE OR REPLACE FUNCTION dev_addr_uint32')
  await sql`
    CREATE OR REPLACE FUNCTION dev_addr_uint32(addr TEXT) RETURNS BIGINT AS $$
      SELECT (
        get_byte(decode(addr, 'hex'), 3)::bigint |
        get_byte(decode(addr, 'hex'), 2)::bigint << 8 |
        get_byte(decode(addr, 'hex'), 1)::bigint << 16 |
        get_byte(decode(addr, 'hex'), 0)::bigint << 24
      )
    $$ LANGUAGE SQL IMMUTABLE
  `;

  console.log('2. CREATE TABLE IF NOT EXISTS packets')
  await sql`
    CREATE TABLE IF NOT EXISTS packets (
      timestamp        TIMESTAMPTZ NOT NULL,
      gateway_id       TEXT NOT NULL,
      packet_type      TEXT NOT NULL,
      dev_addr         TEXT,
      join_eui         TEXT,
      dev_eui          TEXT,
      operator         TEXT NOT NULL DEFAULT '',
      frequency        BIGINT NOT NULL,
      spreading_factor SMALLINT,
      bandwidth        INTEGER NOT NULL,
      rssi             SMALLINT NOT NULL,
      snr              REAL NOT NULL,
      payload_size     INTEGER NOT NULL,
      airtime_us       INTEGER NOT NULL,
      f_cnt            BIGINT,
      f_port           SMALLINT,
      confirmed        BOOLEAN,
      session_id       TEXT
    )
  `;

  console.log('3. Create_hypertable - packets, packets_hourly, packets_channel_sf_hourly')
  await sql`SELECT create_hypertable('packets', 'timestamp', if_not_exists => TRUE)`;

  console.log('4. CREATE TABLE IF NOT EXISTS gateways')
  await sql`
    CREATE TABLE IF NOT EXISTS gateways (
      gateway_id  TEXT PRIMARY KEY,
      name        TEXT,
      alias       TEXT,
      group_name  TEXT,
      first_seen  TIMESTAMPTZ NOT NULL,
      last_seen   TIMESTAMPTZ NOT NULL,
      latitude    DOUBLE PRECISION,
      longitude   DOUBLE PRECISION
    )
  `;

  console.log('5. CREATE TABLE IF NOT EXISTS custom_operators')
  await sql`
    CREATE TABLE IF NOT EXISTS custom_operators (
      id       SERIAL PRIMARY KEY,
      prefix   TEXT NOT NULL,
      name     TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0
    )
  `;

  console.log('6. CREATE TABLE IF NOT EXISTS hide_rules')
  await sql`
    CREATE TABLE IF NOT EXISTS hide_rules (
      id          SERIAL PRIMARY KEY,
      rule_type   TEXT NOT NULL,
      prefix      TEXT NOT NULL,
      description TEXT
    )
  `;

  console.log('7. CREATE MATERIALIZED VIEW IF NOT EXISTS packets_hourly')
  await sql`
    CREATE MATERIALIZED VIEW IF NOT EXISTS packets_hourly
    WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
    SELECT
      time_bucket('1 hour', timestamp) AS hour,
      gateway_id,
      operator,
      packet_type,
      COUNT(*) AS packet_count,
      SUM(airtime_us) AS airtime_us_sum,
      COUNT(DISTINCT dev_addr) AS unique_devices
    FROM packets
    GROUP BY hour, gateway_id, operator, packet_type
  `;

  console.log('8. CREATE MATERIALIZED VIEW IF NOT EXISTS packets_channel_sf_hourly')
  await sql`
    CREATE MATERIALIZED VIEW IF NOT EXISTS packets_channel_sf_hourly
    WITH (timescaledb.continuous, timescaledb.materialized_only = false) AS
    SELECT
      time_bucket('1 hour', timestamp) AS hour,
      gateway_id,
      frequency,
      COALESCE(spreading_factor, 0) AS spreading_factor,
      COUNT(*) AS packet_count,
      SUM(airtime_us) AS airtime_us_sum
    FROM packets
    GROUP BY hour, gateway_id, frequency, spreading_factor
  `;

  // 3. Now add retention policies (after views exist)
  console.log('9. Add retention policies - packets, packets_hourly, packets_channel_sf_hourly')
  await sql`SELECT add_retention_policy('packets', INTERVAL '8 days', if_not_exists => TRUE)`;
  await sql`SELECT add_retention_policy('packets_hourly', INTERVAL '8 days', if_not_exists => TRUE)`;
  await sql`SELECT add_retention_policy('packets_channel_sf_hourly', INTERVAL '8 days', if_not_exists => TRUE)`;

  // 4. Add policies for continuous aggregates
  console.log('10. add_continuous_aggregate_policy - packets hourly')
  await sql`
    SELECT add_continuous_aggregate_policy('packets_hourly',
      start_offset      => INTERVAL '3 days',
      end_offset        => NULL,
      schedule_interval => INTERVAL '2 minutes',
      if_not_exists     => TRUE)
  `;

  console.log('11. add_continuous_aggregate_policy - packets_channel_sf_hourly')
  await sql`
    SELECT add_continuous_aggregate_policy('packets_channel_sf_hourly',
      start_offset      => INTERVAL '3 days',
      end_offset        => NULL,
      schedule_interval => INTERVAL '2 minutes',
      if_not_exists     => TRUE)
  `;

  console.log('12. Creating indexes')
  await sql`CREATE INDEX IF NOT EXISTS packets_gateway_ts_idx ON packets (gateway_id, timestamp DESC)`;
  await sql`CREATE INDEX IF NOT EXISTS packets_dev_addr_ts_idx ON packets (dev_addr, timestamp DESC) WHERE dev_addr IS NOT NULL`;
  await sql`CREATE INDEX IF NOT EXISTS packets_packet_type_ts_idx ON packets (packet_type, timestamp DESC)`;

  // Refresh continuous aggregates on startup so dashboards have data immediately
  console.log('13. Refresh continuous aggregates')
  await sql`CALL refresh_continuous_aggregate('packets_hourly', NULL, NULL)`;
  await sql`CALL refresh_continuous_aggregate('packets_channel_sf_hourly', NULL, NULL)`;

  // ChirpStack Devices packets table
  console.log('14. ChirpStack Devices packets table')
  await sql`
    CREATE TABLE IF NOT EXISTS cs_packets (
      timestamp        TIMESTAMPTZ NOT NULL,
      dev_eui          TEXT NOT NULL,
      dev_addr         TEXT,
      device_name      TEXT NOT NULL DEFAULT '',
      application_id   TEXT NOT NULL DEFAULT '',
      operator         TEXT NOT NULL DEFAULT '',
      frequency        BIGINT NOT NULL,
      spreading_factor SMALLINT,
      bandwidth        INTEGER NOT NULL,
      rssi             SMALLINT NOT NULL,
      snr              REAL NOT NULL,
      payload_size     INTEGER NOT NULL,
      airtime_us       INTEGER NOT NULL,
      f_cnt            BIGINT,
      f_port           SMALLINT,
      confirmed        BOOLEAN
    )
  `;

  console.log('15. SELECT create_hypertable - cs_packets, timestamp, if_not_exists')
  await sql`SELECT create_hypertable('cs_packets', 'timestamp', if_not_exists => TRUE)`;
  console.log('16. SELECT add_retention_policy - cs_packets')
  await sql`SELECT add_retention_policy('cs_packets', INTERVAL '8 days', if_not_exists => TRUE)`;

  // ChirpStack device metadata table (one row per devEUI)
  console.log('17. ChirpStack device metadata table')
  await sql`
    CREATE TABLE IF NOT EXISTS cs_devices (
      dev_eui          TEXT PRIMARY KEY,
      dev_addr         TEXT,
      device_name      TEXT NOT NULL,
      application_id   TEXT NOT NULL,
      application_name TEXT,
      last_seen        TIMESTAMPTZ NOT NULL,
      packet_count     BIGINT NOT NULL DEFAULT 0
    )
  `;

  console.log('18. CREATE INDEX IF NOT EXISTS cs_packets_dev_eui_ts_idx ON cs_packets')
  await sql`CREATE INDEX IF NOT EXISTS cs_packets_dev_eui_ts_idx ON cs_packets (dev_eui, timestamp DESC)`;

  console.log('Migrations complete...');
}
