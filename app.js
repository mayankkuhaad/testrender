import express from 'express';
import dotenv from 'dotenv';
import { pool,connectToDatabase } from './config/connectDb.js';
import bodyParser from 'body-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import authenticateJWT from './middlewares/auth.js'
import cors from 'cors';
import axios from 'axios';

const app = express();
const port = 4001;
const VERCEL_API_TOKEN = 'JdkA70XlgrkO0vmwiLEdkhJc';
const VERCEL_PROJECT_ID = 'YOUR_PROJECT_ID';
app.use(express.json());
app.use(bodyParser.json());

app.use(cors({
    origin: '*',
    credentials: true,
    allowedHeaders: ['Origin', 'X-Requested-With', 'Content-Type', 'Authorization'],
    methods: 'GET, POST, PUT, DELETE'
}))
dotenv.config();
connectToDatabase();

app.get('/', (req,res)=>{
    res.send('Hello, World!');
});

app.post('/signup', async (req, res) => {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
            [username, email, hashedPassword]
        );
        const userId = result.rows[0].id;
        res.status(201).json({ userId , email});
    } catch (err) {
        console.error('Error adding user:', err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});


app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required' });
    }
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const user = result.rows[0];
        if (user && await bcrypt.compare(password, user.password_hash)) {
            const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, { expiresIn: '1h' });
            res.json({ token, user });
        } else {
            res.status(401).json({ error: 'Invalid credentials' });
        }
    } catch (err) {
        console.error('Error logging in:', err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});



app.post('/blogs', authenticateJWT, async (req, res) => {
    const { title, content } = req.body;
    const userId = req.user.userId;
    if (!title || !content) {
        return res.status(400).json({ error: 'Title and content are required' });
    }
    try {
        const result = await pool.query(
            'INSERT INTO blogs (title, content, user_id) VALUES ($1, $2, $3) RETURNING id',
            [title, content, userId]
        );
        const blogId = result.rows[0].id;
        const blog = await pool.query('SELECT * FROM blogs WHERE id = $1', [blogId]);
        res.status(201).json({ blogId, blog });
    } catch (err) {
        console.error('Error adding blog:', err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get All Blogs
app.get('/blogs', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM blogs');
        res.json(result.rows);
    } catch (err) {
        console.error('Error fetching blogs:', err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});

// Get Blog by ID
app.get('/blogs/:id', async (req, res) => {
    const blogId = parseInt(req.params.id, 10);

    if (isNaN(blogId)) {
        return res.status(400).json({ error: 'Invalid blog ID' });
    }

    try {
        const result = await pool.query('SELECT * FROM blogs WHERE id = $1', [blogId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Blog not found' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error fetching blog:', err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});

// Update Blog by ID
app.patch('/blogs/:id', authenticateJWT, async (req, res) => {
    const blogId = parseInt(req.params.id, 10);
    const { title, content } = req.body;
    const userId = req.user.userId;

    if (isNaN(blogId)) {
        return res.status(400).json({ error: 'Invalid blog ID' });
    }

    if (!title && !content) {
        return res.status(400).json({ error: 'Title or content required' });
    }

    try {
        // Check if the blog belongs to the user
        const checkResult = await pool.query('SELECT * FROM blogs WHERE id = $1 AND user_id = $2', [blogId, userId]);
        if (checkResult.rows.length === 0) {
            return res.status(403).json({ error: 'Not authorized to update this blog' });
        }

        // Update the blog
        const updateQuery = 'UPDATE blogs SET title = COALESCE($1, title), content = COALESCE($2, content) WHERE id = $3 RETURNING *';
        const result = await pool.query(updateQuery, [title, content, blogId]);
        
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error updating blog:', err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});

// Delete Blog by ID
app.delete('/blogs/:id', authenticateJWT, async (req, res) => {
    const blogId = parseInt(req.params.id, 10);
    const userId = req.user.userId;

    if (isNaN(blogId)) {
        return res.status(400).json({ error: 'Invalid blog ID' });
    }

    try {
        // Check if the blog belongs to the user
        const checkResult = await pool.query('SELECT * FROM blogs WHERE id = $1 AND user_id = $2', [blogId, userId]);
        if (checkResult.rows.length === 0) {
            return res.status(403).json({ error: 'Not authorized to delete this blog' });
        }

        // Delete the blog
        await pool.query('DELETE FROM blogs WHERE id = $1', [blogId]);
        res.status(204).send(); // No Content
    } catch (err) {
        console.error('Error deleting blog:', err.stack);
        res.status(500).json({ error: 'Server error' });
    }
});

function combineFiles(html, css, js, customWebsiteName) {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${customWebsiteName}</title>
    <style>
        ${css}
    </style>
</head>
<body>
    ${html}

    <script>
        ${js}
    </script>
</body>
</html>
    `;
}

app.post('/deploy', async (req, res) => {
    const { html, css, js, customWebsiteName } = req.body;

    try {
        // Combine HTML, CSS, and JS into a single file (in this case, we'll assume it's `index.html`)
        const combinedFile = `
          <!DOCTYPE html>
          <html lang="en">
          <head>
              <meta charset="UTF-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>${customWebsiteName}</title>
              <style>${css}</style>
          </head>
          <body>
              ${html}
              <script>${js}</script>
          </body>
          </html>
        `;
console.log(combinedFile);
        // Prepare the deployment files array
        const deploymentFiles = [
            {
                file: 'index.html',
                // data: Buffer.from(combinedFile).toString('base64'),
                data: combinedFile

            }
        ];

        // Deploy to Vercel using their API
        const response = await axios.post('https://api.vercel.com/v13/deployments', {
            name: customWebsiteName,
            files: deploymentFiles,
            target: 'production', // Can be 'production' or 'staging'
            projectSettings: {
                framework:null, // or 'blitzjs' or other frameworks
            }
        }, {
            headers: {
                'Authorization': `Bearer ${VERCEL_API_TOKEN}`, // Ensure your Vercel API token is set in your environment variables
                'Content-Type': 'application/json'
            }
        });

        res.status(200).json({
            message: 'Deployment triggered successfully',
            deploymentFiles: deploymentFiles,
            vercelResponse: response.data
        });
    } catch (error) {
        console.error('Deployment error:', error.message);
        res.status(500).json({
            error: 'Deployment failed',
            details: error.message
        });
    }
});




app.post('/school', async (req, res) => {
    const {schoolName, schoolWebsiteLink, content} = req.body;
    if (!schoolName ||!schoolWebsiteLink ||!content) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    try {
        const result = await pool.query(
            'INSERT INTO schools (school_name, school_website_link, content) VALUES ($1, $2, $3) RETURNING id',
            [schoolName, schoolWebsiteLink, content]
        );
        const schoolId = result.rows[0].id;
        res.status(201).json({ schoolId, schoolName, schoolWebsiteLink, content });
    } catch (err) {
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/schools', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM schools');
        res.status(200).json(result.rows);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});

app.get('/schools/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query('SELECT * FROM schools WHERE id = $1', [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'School not found' });
        }

        res.status(200).json(result.rows[0]);
    } catch (err) {
        console.error(err.message);
        res.status(500).json({ error: 'Server error' });
    }
});


app.listen(port, ()=>{
    console.log(`Server running at http://localhost:${port}`);
})