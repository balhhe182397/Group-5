const express = require('express');
const router = express.Router();
const db = require('../config/database');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

// Get comments for a specific book
router.get('/book/:bookId', async (req, res) => {
    try {
        const [comments] = await db.execute(`
            SELECT c.*, u.username, u.full_name, u.role
            FROM comments c
            JOIN users u ON c.user_id = u.id
            WHERE c.book_id = ? AND c.is_approved = TRUE
            ORDER BY c.created_at DESC
        `, [req.params.bookId]);

        res.json(comments);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching comments' });
    }
});

// Add a new comment
router.post('/add', isAuthenticated, async (req, res) => {
    try {
        const { book_id, content, rating } = req.body;
        const user_id = req.session.user.id;

        // Validate rating
        if (rating && (rating < 1 || rating > 5)) {
            return res.status(400).json({ error: 'Rating must be between 1 and 5' });
        }

        // Check if user has already commented on this book
        const [existingComment] = await db.execute(
            'SELECT * FROM comments WHERE book_id = ? AND user_id = ?',
            [book_id, user_id]
        );

        if (existingComment.length > 0) {
            return res.status(400).json({ error: 'You have already commented on this book' });
        }

        // Insert new comment
        await db.execute(
            'INSERT INTO comments (book_id, user_id, content, rating) VALUES (?, ?, ?, ?)',
            [book_id, user_id, content, rating || null]
        );

        // Get the newly created comment with user info
        const [newComment] = await db.execute(`
            SELECT c.*, u.username, u.full_name, u.role
            FROM comments c
            JOIN users u ON c.user_id = u.id
            WHERE c.id = LAST_INSERT_ID()
        `);

        res.json({ success: true, comment: newComment[0] });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error adding comment' });
    }
});

// Update comment (only by comment owner or admin)
router.put('/update/:commentId', isAuthenticated, async (req, res) => {
    try {
        const { content, rating } = req.body;
        const commentId = req.params.commentId;
        const userId = req.session.user.id;

        // Check if comment exists and user has permission
        const [comment] = await db.execute(
            'SELECT * FROM comments WHERE id = ?',
            [commentId]
        );

        if (comment.length === 0) {
            return res.status(404).json({ error: 'Comment not found' });
        }

        if (comment[0].user_id !== userId && req.session.user.role !== 'admin') {
            return res.status(403).json({ error: 'Permission denied' });
        }

        // Update comment
        await db.execute(
            'UPDATE comments SET content = ?, rating = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [content, rating, commentId]
        );

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error updating comment' });
    }
});

// Delete comment (only by comment owner or admin)
router.delete('/delete/:commentId', isAuthenticated, async (req, res) => {
    try {
        const commentId = req.params.commentId;
        const userId = req.session.user.id;

        // Check if comment exists and user has permission
        const [comment] = await db.execute(
            'SELECT * FROM comments WHERE id = ?',
            [commentId]
        );

        if (comment.length === 0) {
            return res.status(404).json({ error: 'Comment not found' });
        }

        if (comment[0].user_id !== userId && req.session.user.role !== 'admin') {
            return res.status(403).json({ error: 'Permission denied' });
        }

        // Delete comment
        await db.execute('DELETE FROM comments WHERE id = ?', [commentId]);

        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error deleting comment' });
    }
});

// Admin: Approve/Reject comment
router.post('/approve/:commentId', isAdmin, async (req, res) => {
    try {
        const { is_approved } = req.body;
        await db.execute(
            'UPDATE comments SET is_approved = ? WHERE id = ?',
            [is_approved, req.params.commentId]
        );
        res.json({ success: true });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error updating comment approval status' });
    }
});

// Get pending comments (admin only)
router.get('/pending', isAdmin, async (req, res) => {
    try {
        const [comments] = await db.execute(`
            SELECT c.*, u.username, u.full_name, b.title as book_title
            FROM comments c
            JOIN users u ON c.user_id = u.id
            JOIN books b ON c.book_id = b.id
            WHERE c.is_approved = FALSE
            ORDER BY c.created_at DESC
        `);
        res.json(comments);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching pending comments' });
    }
});

module.exports = router; 