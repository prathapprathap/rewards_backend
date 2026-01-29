// Add this to add sample data to your database
// Run: node addSampleData.js

require('dotenv').config();
const db = require('./config/db');

async function addSampleData() {
    try {
        // Add sample tasks
        const tasks = [
            {
                title: 'Watch Ad',
                description: 'Watch a short advertisement',
                reward_coins: 5,
                icon_color: '0xFF2196F3',
                action_url: 'https://example.com/ad'
            },
            {
                title: 'Complete Survey',
                description: 'Fill out a quick survey',
                reward_coins: 10,
                icon_color: '0xFF4CAF50',
                action_url: 'https://example.com/survey'
            },
            {
                title: 'Share App',
                description: 'Share app with friends',
                reward_coins: 15,
                icon_color: '0xFFFF9800',
                action_url: 'https://example.com/share'
            }
        ];

        for (const task of tasks) {
            await db.query(
                'INSERT INTO tasks (title, description, reward_coins, icon_color, action_url) VALUES (?, ?, ?, ?, ?)',
                [task.title, task.description, task.reward_coins, task.icon_color, task.action_url]
            );
        }

        // Add sample offers
        const offers = [
            {
                offer_name: 'Welcome Bonus',
                offer_id: 'WELCOME001',
                heading: 'Get ₹100 Bonus',
                history_name: 'Welcome Offer',
                offer_url: 'https://example.com/offer1',
                amount: 100,
                event_name: 'signup',
                description: 'Sign up and get instant ₹100',
                image_url: 'https://via.placeholder.com/150',
                refer_payout: 50,
                status: 'active'
            },
            {
                offer_name: 'First Purchase',
                offer_id: 'FIRST001',
                heading: 'Get ₹200 on First Order',
                history_name: 'First Purchase Offer',
                offer_url: 'https://example.com/offer2',
                amount: 200,
                event_name: 'first_purchase',
                description: 'Make your first purchase and earn',
                image_url: 'https://via.placeholder.com/150',
                refer_payout: 100,
                status: 'active'
            }
        ];

        for (const offer of offers) {
            await db.query(
                `INSERT INTO offers (offer_name, offer_id, heading, history_name, offer_url, 
         amount, event_name, description, image_url, refer_payout, status) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    offer.offer_name, offer.offer_id, offer.heading, offer.history_name,
                    offer.offer_url, offer.amount, offer.event_name, offer.description,
                    offer.image_url, offer.refer_payout, offer.status
                ]
            );
        }

        console.log('✅ Sample data added successfully!');
        console.log(`- Added ${tasks.length} tasks`);
        console.log(`- Added ${offers.length} offers`);
        process.exit(0);
    } catch (error) {
        console.error('❌ Error adding sample data:', error);
        process.exit(1);
    }
}

addSampleData();
