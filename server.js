const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const dotenv = require('dotenv');
const db = require('./config/db');
const userRoutes = require('./routes/userRoutes');
const adminRoutes = require('./routes/adminRoutes');
const walletRoutes = require('./routes/walletRoutes');
const offer18Routes = require('./routes/offer18Routes');

const http = require('http');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Routes
app.use('/api/users', userRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/offer18', offer18Routes);

// Database Keep-Alive Route
app.get('/api/db-keep-alive', async (req, res) => {
    try {
        await db.query('SELECT 1');
        res.status(200).send('Database is awake');
    } catch (error) {
        console.error('Keep-alive failed:', error);
        res.status(500).send('Database connection error');
    }
});

app.get('/', (req, res) => {
    res.send('HotReward Backend is running');
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
