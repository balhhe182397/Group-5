const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isAuthenticated, isAdmin } = require('../middleware/auth');
const multer = require('multer');
const path = require('path');

// Configure multer for image upload
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/books')
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname)
    }
});

const upload = multer({
    storage: storage,
    fileFilter: function (req, file, cb) {
        const filetypes = /jpeg|jpg|png|gif/;
        const mimetype = filetypes.test(file.mimetype);
        const extname = filetypes.test(path.extname(file.originalname).toLowerCase());

        if (mimetype && extname) {
            return cb(null, true);
        }
        cb(new Error('Only image files are allowed!'));
    }
});

// Get all books
router.get('/', async (req, res) => {
    try {
        const search = req.query.search || '';
        let query = 'SELECT * FROM books';
        let params = [];

        if (search) {
            query += ' WHERE title LIKE ? OR author LIKE ? OR isbn LIKE ?';
            params = [`%${search}%`, `%${search}%`, `%${search}%`];
        }

        query += ' ORDER BY title ASC';
        const [books] = await db.query(query, params);
        res.render('books/index', { books, search });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while fetching books');
        res.redirect('/');
    }
});

// Add book form
router.get('/add', isAdmin, (req, res) => {
    res.render('books/add');
});

// Add book process
router.post('/add', isAdmin, upload.single('cover_image'), async (req, res) => {
    try {
        const { title, author, isbn, category, quantity } = req.body;
        const cover_image = req.file ? `/uploads/books/${req.file.filename}` : null;
        
        await db.query(
            'INSERT INTO books (title, author, isbn, category, quantity, available_quantity, cover_image) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [title, author, isbn, category, quantity, quantity, cover_image]
        );
        req.flash('success_msg', 'Book added successfully');
        res.redirect('/books');
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while adding book');
        res.redirect('/books/add');
    }
});

// Edit book form
router.get('/edit/:id', isAdmin, async (req, res) => {
    try {
        const [books] = await db.query('SELECT * FROM books WHERE id = ?', [req.params.id]);
        if (books.length === 0) {
            req.flash('error_msg', 'Book not found');
            return res.redirect('/books');
        }
        res.render('books/edit', { book: books[0] });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while fetching book');
        res.redirect('/books');
    }
});

// Edit book process
router.post('/edit/:id', isAdmin, upload.single('cover_image'), async (req, res) => {
    try {
        const { title, author, isbn, category, quantity } = req.body;
        const [book] = await db.query('SELECT * FROM books WHERE id = ?', [req.params.id]);
        
        if (book.length === 0) {
            req.flash('error_msg', 'Book not found');
            return res.redirect('/books');
        }

        const currentQuantity = book[0].quantity;
        const borrowedQuantity = currentQuantity - book[0].available_quantity;
        const newAvailableQuantity = Math.max(0, quantity - borrowedQuantity);
        
        let cover_image = book[0].cover_image;
        if (req.file) {
            cover_image = `/uploads/books/${req.file.filename}`;
        }

        await db.query(
            'UPDATE books SET title = ?, author = ?, isbn = ?, category = ?, quantity = ?, available_quantity = ?, cover_image = ? WHERE id = ?',
            [title, author, isbn, category, quantity, newAvailableQuantity, cover_image, req.params.id]
        );
        req.flash('success_msg', 'Book updated successfully');
        res.redirect('/books');
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while updating book');
        res.redirect('/books');
    }
});

// Delete book
router.post('/delete/:id', isAdmin, async (req, res) => {
    try {
        await db.query('DELETE FROM books WHERE id = ?', [req.params.id]);
        req.flash('success_msg', 'Book deleted successfully');
        res.redirect('/books');
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while deleting book');
        res.redirect('/books');
    }
});

module.exports = router; 