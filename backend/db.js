const { Pool } = require('pg');
require('dotenv').config();

const dbUrl = process.env.DATABASE_URL || '';
const isLocalhost = !dbUrl || dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1') || process.env.PGHOST === 'localhost';

const poolConfig = process.env.PGPASSWORD ? {
  user: process.env.PGUSER || 'postgres',
  password: process.env.PGPASSWORD,
  host: process.env.PGHOST || 'localhost',
  port: parseInt(process.env.PGPORT || '5432'),
  database: process.env.PGDATABASE || 'learnapp',
  ssl: isLocalhost ? false : { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
} : {
  connectionString: dbUrl,
  ssl: isLocalhost ? false : { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
};

const pool = new Pool(poolConfig);

async function initDB() {
  const client = await pool.connect();
  try {
    // Firms table
    await client.query(`
      CREATE TABLE IF NOT EXISTS firms (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Insert default firm for existing data
    await client.query(`
      INSERT INTO firms (name) VALUES ('Default Firm') ON CONFLICT (name) DO NOTHING
    `);

    // Activation tokens table
    await client.query(`
      CREATE TABLE IF NOT EXISTS activation_tokens (
        id SERIAL PRIMARY KEY,
        token VARCHAR(64) NOT NULL UNIQUE,
        firm_id INTEGER NOT NULL REFERENCES firms(id) ON DELETE CASCADE,
        expires_at TIMESTAMP NOT NULL,
        is_used BOOLEAN DEFAULT FALSE,
        device_id VARCHAR(255) DEFAULT NULL,
        revoke_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await client.query(`ALTER TABLE activation_tokens ADD COLUMN IF NOT EXISTS revoke_count INTEGER DEFAULT 0`);
    await client.query(`ALTER TABLE activation_tokens ADD COLUMN IF NOT EXISTS pin_hash TEXT DEFAULT NULL`);
    await client.query(`ALTER TABLE activation_tokens ADD COLUMN IF NOT EXISTS pin_salt TEXT DEFAULT NULL`);
    await client.query(`ALTER TABLE activation_tokens ADD COLUMN IF NOT EXISTS pin_reset_required BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE activation_tokens ADD COLUMN IF NOT EXISTS username VARCHAR(255) DEFAULT ''`);
    await client.query(`ALTER TABLE activation_tokens ADD COLUMN IF NOT EXISTS used_at TIMESTAMP DEFAULT NULL`);

    await client.query(`
      CREATE TABLE IF NOT EXISTS entries (
        id SERIAL PRIMARY KEY,
        firm_id INTEGER REFERENCES firms(id) ON DELETE CASCADE,
        entry_date DATE NOT NULL,
        name VARCHAR(255) NOT NULL,
        quality VARCHAR(10) NOT NULL,
        item VARCHAR(255) NOT NULL,
        bags INTEGER NOT NULL,
        bharti_pairs TEXT DEFAULT '[]',
        weight NUMERIC(10,2) DEFAULT 0,
        rate NUMERIC(10,2) DEFAULT 0,
        lessrate NUMERIC(10,2) DEFAULT 0,
        amount NUMERIC(10,2) DEFAULT 0,
        commission NUMERIC(10,2) DEFAULT 0,
        other_amount NUMERIC(10,2) DEFAULT 0,
        total NUMERIC(10,2) DEFAULT 0,
        market_fee NUMERIC(10,2) DEFAULT 0,
        p_amount NUMERIC(10,2) DEFAULT 0,
        is_marked BOOLEAN DEFAULT FALSE,
        is_paid BOOLEAN DEFAULT FALSE,
        bill_number VARCHAR(100) DEFAULT '',
        godown VARCHAR(255) DEFAULT '',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    // Migrations for existing tables
    await client.query(`ALTER TABLE entries ADD COLUMN IF NOT EXISTS bill_number VARCHAR(100) DEFAULT ''`);
    await client.query(`ALTER TABLE entries ADD COLUMN IF NOT EXISTS godown VARCHAR(255) DEFAULT ''`);
    await client.query(`ALTER TABLE entries ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT FALSE`);
    await client.query(`ALTER TABLE entries ADD COLUMN IF NOT EXISTS firm_id INTEGER REFERENCES firms(id) ON DELETE CASCADE`);

    // Assign existing entries without firm_id to Default Firm
    await client.query(`
      UPDATE entries SET firm_id = (SELECT id FROM firms WHERE name = 'Default Firm')
      WHERE firm_id IS NULL
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS create_lists (
        id SERIAL PRIMARY KEY,
        firm_id INTEGER REFERENCES firms(id) ON DELETE CASCADE,
        section VARCHAR(50) NOT NULL,
        value VARCHAR(255) NOT NULL,
        UNIQUE(firm_id, section, value)
      )
    `);

    // Migrate existing create_lists to default firm
    await client.query(`ALTER TABLE create_lists ADD COLUMN IF NOT EXISTS firm_id INTEGER REFERENCES firms(id) ON DELETE CASCADE`);
    await client.query(`
      UPDATE create_lists SET firm_id = (SELECT id FROM firms WHERE name = 'Default Firm')
      WHERE firm_id IS NULL
    `);

    // Indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_entries_entry_date ON entries(entry_date DESC)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_entries_name ON entries(name)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_entries_is_marked ON entries(is_marked)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_entries_date_name ON entries(entry_date DESC, name)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_entries_firm_id ON entries(firm_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tokens_token ON activation_tokens(token)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_tokens_firm_id ON activation_tokens(firm_id)`);

    console.log('Database initialized successfully');
  } finally {
    client.release();
  }
}

module.exports = { pool, initDB };
