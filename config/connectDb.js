import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

const connectToDatabase = async () => {
    try {
        const client = await pool.connect();
        console.log(`Database connected on port ${process.env.DB_PORT}`);
        client.release(); // Release the client back to the pool
    } catch (err) {
        console.error('Database connection error:', err.stack);
    }
};

export { pool, connectToDatabase };
