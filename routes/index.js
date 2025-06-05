const express = require('express');
const router = express.Router();
const db = require('../config/database');

// Homepage
router.get('/', async (req, res) => {
    try {
        // Get recent books
        const [recentBooks] = await db.execute(`
            SELECT * FROM books 
            ORDER BY created_at DESC 
            LIMIT 6
        `);

        // Get popular books (most borrowed)
        const [popularBooks] = await db.execute(`
            SELECT b.*, COUNT(br.id) as borrow_count 
            FROM books b 
            LEFT JOIN borrows br ON b.id = br.book_id 
            GROUP BY b.id 
            ORDER BY borrow_count DESC 
            LIMIT 6
        `);

        res.render('index', {
            recentBooks,
            popularBooks
        });
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error loading homepage');
        res.render('index', {
            recentBooks: [],
            popularBooks: []
        });
    }
});

// Contact page
router.get('/contact', (req, res) => {
    res.render('contact', {
        user: req.session.user
    });
});

module.exports = router; 