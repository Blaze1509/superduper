const { Client } = require('pg');

const candidates = [
  'Joy@12345',
  'postgres',
  'admin',
  'root',
  '123456',
  '1234',
  'Blaze@1509',
  'JoyPatel',
  'JoyPatel@123',
  'Joy@123',
  'password'
];

(async () => {
  for (const pass of candidates) {
    const client = new Client({
      user: 'postgres',
      password: pass,
      host: 'localhost',
      port: 5432,
      database: 'postgres'
    });
    try {
      await client.connect();
      console.log('SUCCESS_PASSWORD_FOUND:', pass);
      await client.end();
      process.exit(0);
    } catch (e) {
      // failed
    }
  }
  console.log('NONE_OF_COMMON_PASSWORDS_WORKED');
  process.exit(1);
})();
