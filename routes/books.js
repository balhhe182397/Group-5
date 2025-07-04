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

        // Get all categories for the filter dropdown
        const [categories] = await db.query('SELECT DISTINCT category FROM books WHERE category IS NOT NULL');

        res.render('books/index', { 
            books, 
            searchQuery: search,
            selectedCategory: '',
            sortBy: 'title',
            categories: categories.map(c => c.category)
        });
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
        console.log('Attempting to delete book with ID:', req.params.id);
        
        // Check if book exists
        const [books] = await db.query('SELECT * FROM books WHERE id = ?', [req.params.id]);
        if (books.length === 0) {
            console.log('Book not found with ID:', req.params.id);
            req.flash('error_msg', 'Book not found');
            return res.redirect('/books');
        }

        console.log('Found book:', books[0].title);

        // Check if book is currently borrowed
        const [borrows] = await db.query(
            'SELECT COUNT(*) as count FROM borrows WHERE book_id = ? AND status IN ("requested", "borrowed")',
            [req.params.id]
        );

        console.log('Active borrows for this book:', borrows[0].count);

        if (borrows[0].count > 0) {
            console.log('Cannot delete - book is currently borrowed');
            
            // Lấy thông tin chi tiết về các lần mượn
            const [borrowDetails] = await db.query(`
                SELECT br.*, u.full_name, u.email, u.student_id, u.lecturer_id
                FROM borrows br 
                JOIN users u ON br.user_id = u.id 
                WHERE br.book_id = ? AND br.status IN ("requested", "borrowed")
                ORDER BY br.request_date DESC
            `, [req.params.id]);
            
            errorMessage = `Cannot delete book "${books[0].title}" because it has ${borrows[0].count} active borrow(s).\n\nPlease wait for all books to be returned or cancel pending requests before deleting.`;
            
            req.flash('error_msg', errorMessage);
            return res.redirect('/books');
        }

        // Check for any borrow records (including returned ones)
        const [allBorrows] = await db.query(
            'SELECT COUNT(*) as count FROM borrows WHERE book_id = ?',
            [req.params.id]
        );

        console.log('Total borrow records for this book:', allBorrows[0].count);

        // Delete the book
        console.log('Attempting to delete book from database...');
        const [result] = await db.query('DELETE FROM books WHERE id = ?', [req.params.id]);
        
        console.log('Delete result:', result);
        
        if (result.affectedRows > 0) {
            console.log('Book deleted successfully');
            req.flash('success_msg', 'Book deleted successfully');
        } else {
            console.log('No rows were deleted');
            req.flash('error_msg', 'Book was not deleted');
        }
        
        res.redirect('/books');
    } catch (err) {
        console.error('Error deleting book:', err);
        console.error('Error code:', err.code);
        console.error('Error message:', err.message);
        
        // Check for foreign key constraint error
        if (err.code === 'ER_ROW_IS_REFERENCED_2') {
            // Lấy thông tin về lịch sử mượn
            const [borrowHistory] = await db.query(`
                SELECT COUNT(*) as total_borrows,
                       SUM(CASE WHEN status IN ('requested', 'borrowed') THEN 1 ELSE 0 END) as active_borrows
                FROM borrows WHERE book_id = ?
            `, [req.params.id]);
            
            let errorMessage = `Cannot delete book "${books[0].title}" because it has related data:\n\n`;
            errorMessage += `- Total borrows: ${borrowHistory[0].total_borrows}\n`;
            errorMessage += `- Currently borrowed: ${borrowHistory[0].active_borrows}\n\n`;
            errorMessage += 'To delete this book, you need to:\n';
            errorMessage += '1. Wait for all books to be returned\n';
            errorMessage += '2. Or delete all borrow history for this book\n';
            errorMessage += '3. Or contact system administrator for assistance';
            
            req.flash('error_msg', errorMessage);
        } else {
            req.flash('error_msg', 'An error occurred while deleting book: ' + err.message);
        }
        res.redirect('/books');
    }
});

// Search books with filters
router.get('/search', async (req, res) => {
    try {
        const { search, category, sort } = req.query;
        let query = `
            SELECT b.*, COUNT(br.id) as borrow_count 
            FROM books b 
            LEFT JOIN borrows br ON b.id = br.book_id 
        `;
        let params = [];
        let whereConditions = [];

        // Add search condition
        if (search) {
            whereConditions.push('(b.title LIKE ? OR b.author LIKE ? OR b.isbn LIKE ?)');
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        // Add category filter
        if (category) {
            whereConditions.push('b.category = ?');
            params.push(category);
        }

        // Add WHERE clause if there are conditions
        if (whereConditions.length > 0) {
            query += ' WHERE ' + whereConditions.join(' AND ');
        }

        // Add GROUP BY
        query += ' GROUP BY b.id';

        // Add sorting
        switch (sort) {
            case 'borrows':
                query += ' ORDER BY borrow_count DESC';
                break;
            case 'recent':
                query += ' ORDER BY b.created_at DESC';
                break;
            case 'title':
                query += ' ORDER BY b.title ASC';
                break;
            case 'author':
                query += ' ORDER BY b.author ASC';
                break;
            default:
                query += ' ORDER BY borrow_count DESC';
        }

        const [books] = await db.query(query, params);

        // Get all categories for the filter dropdown
        const [categories] = await db.query('SELECT DISTINCT category FROM books WHERE category IS NOT NULL');

        res.render('books/index', {
            books,
            searchQuery: search,
            selectedCategory: category,
            sortBy: sort,
            categories: categories.map(c => c.category)
        });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while searching books');
        res.redirect('/books');
    }
});

// Book detail page
router.get('/detail/:id', async (req, res) => {
    try {
        const [books] = await db.execute('SELECT * FROM books WHERE id = ?', [req.params.id]);
        if (books.length === 0) {
            req.flash('error_msg', 'Book not found');
            return res.redirect('/books');
        }

        const book = books[0];
        
        // Get average rating
        const [ratingResult] = await db.execute(`
            SELECT AVG(rating) as avg_rating, COUNT(*) as total_ratings
            FROM comments 
            WHERE book_id = ? AND rating IS NOT NULL AND is_approved = TRUE
        `, [req.params.id]);

        const avgRating = ratingResult[0].avg_rating || 0;
        const totalRatings = ratingResult[0].total_ratings || 0;

        res.render('books/detail', { 
            book: {
                ...book,
                avgRating: parseFloat(avgRating).toFixed(1),
                totalRatings
            },
            user: req.session.user
        });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while fetching book details');
        res.redirect('/books');
    }
});

// Test route for debugging delete functionality
router.get('/test-delete', isAdmin, (req, res) => {
    res.render('test-delete');
});

// Route to check book status before deletion
router.get('/check-delete/:id', isAdmin, async (req, res) => {
    try {
        const [books] = await db.query('SELECT * FROM books WHERE id = ?', [req.params.id]);
        if (books.length === 0) {
            return res.json({ canDelete: false, message: 'Book not found' });
        }

        const book = books[0];
        
        // Check borrow status
        const [borrows] = await db.query(`
            SELECT br.*, u.full_name, u.email, u.student_id, u.lecturer_id
            FROM borrows br 
            JOIN users u ON br.user_id = u.id 
            WHERE br.book_id = ? AND br.status IN ("requested", "borrowed")
            ORDER BY br.request_date DESC
        `, [req.params.id]);

        if (borrows.length > 0) {
            let message = `Cannot delete book "${book.title}" because it has ${borrows.length} active borrow(s).\n\nPlease wait for all books to be returned or cancel pending requests before deleting.`;
            
            return res.json({ canDelete: false, message: message });
        }

        // Check total borrow history
        const [allBorrows] = await db.query(
            'SELECT COUNT(*) as count FROM borrows WHERE book_id = ?',
            [req.params.id]
        );

        if (allBorrows[0].count > 0) {
            return res.json({ 
                canDelete: false, 
                message: `Book "${book.title}" has ${allBorrows[0].count} borrow(s) in history. Are you sure you want to delete all borrow history?` 
            });
        }

        return res.json({ canDelete: true, message: `Book "${book.title}" can be deleted` });
    } catch (err) {
        console.error('Error checking book status:', err);
        res.json({ canDelete: false, message: 'An error occurred while checking book status' });
    }
});

// Simple test delete route without authentication
router.post('/test-delete/:id', async (req, res) => {
    try {
        console.log('Test delete route called with ID:', req.params.id);
        console.log('User session:', req.session.user);
        
        const [books] = await db.query('SELECT * FROM books WHERE id = ?', [req.params.id]);
        if (books.length === 0) {
            return res.json({ success: false, message: 'Book not found' });
        }
        
        const [result] = await db.query('DELETE FROM books WHERE id = ?', [req.params.id]);
        
        if (result.affectedRows > 0) {
            res.json({ success: true, message: 'Book deleted successfully' });
        } else {
            res.json({ success: false, message: 'No rows deleted' });
        }
    } catch (err) {
        console.error('Test delete error:', err);
        res.json({ success: false, message: err.message });
    }
});

module.exports = router; 