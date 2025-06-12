const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/database');
const transporter = require('../config/email');
const { isAuthenticated, isAdmin } = require('../middleware/auth');

// Configure multer for ID card uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/id-cards');
    },
    filename: function (req, file, cb) {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    fileFilter: function (req, file, cb) {
        if (!file.originalname.match(/\.(jpg|jpeg|png)$/)) {
            return cb(new Error('Only image files are allowed!'), false);
        }
        cb(null, true);
    },
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

// Login page
router.get('/login', (req, res) => {
    res.render('users/login');
});

// Register page
router.get('/register', (req, res) => {
    res.render('users/register');
});

// Login process
router.post('/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const [users] = await db.execute('SELECT * FROM users WHERE username = ?', [username]);
        if (users.length === 0) {
            req.flash('error_msg', 'Invalid username or password');
            return res.redirect('/users/login');
        }

        const user = users[0];
        
        // Check if user is verified
        if (!user.is_verified) {
            req.flash('error_msg', 'Your account is pending verification. Please wait for admin approval.');
            return res.redirect('/users/login');
        }

        // For admin user with unencrypted password
        if (user.role === 'admin' && user.username === 'admin') {
            if (password !== user.password) {
                req.flash('error_msg', 'Invalid username or password');
                return res.redirect('/users/login');
            }
        } else {
            // For other users with bcrypt hashed passwords
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                req.flash('error_msg', 'Invalid username or password');
                return res.redirect('/users/login');
            }
        }

        req.session.user = {
            id: user.id,
            username: user.username,
            role: user.role
        };
        res.redirect('/');
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'An error occurred');
        res.redirect('/users/login');
    }
});

// Register process
router.post('/register', upload.single('idCard'), async (req, res) => {
    try {
        const { username, email, fullName, password, role, studentId, lecturerId } = req.body;

        // Check if username or email already exists
        const [existingUsers] = await db.query(
            'SELECT * FROM users WHERE username = ? OR email = ?',
            [username, email]
        );

        if (existingUsers.length > 0) {
            req.flash('error_msg', 'Username or email already exists');
            return res.redirect('/users/register');
        }

        // Check for duplicate student/lecturer ID
        if (role === 'student' && studentId) {
            const [existingStudent] = await db.query(
                'SELECT * FROM users WHERE student_id = ?',
                [studentId]
            );
            if (existingStudent.length > 0) {
                req.flash('error_msg', 'This student ID is already registered');
                return res.redirect('/users/register');
            }
        } else if (role === 'lecturer' && lecturerId) {
            const [existingLecturer] = await db.query(
                'SELECT * FROM users WHERE lecturer_id = ?',
                [lecturerId]
            );
            if (existingLecturer.length > 0) {
                req.flash('error_msg', 'This lecturer ID is already registered');
                return res.redirect('/users/register');
            }
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Insert new user
        const [result] = await db.query(
            'INSERT INTO users (username, email, full_name, password, role, student_id, lecturer_id, id_card_image, is_verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [username, email, fullName, hashedPassword, role, studentId, lecturerId, req.file.filename, false]
        );

        req.flash('success_msg', 'Registration successful! Please wait for admin verification.');
        res.redirect('/users/login');
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred during registration');
        res.redirect('/users/register');
    }
});

// Logout
router.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/users/login');
});

// User profile
router.get('/profile', isAuthenticated, async (req, res) => {
    try {
        const [user] = await db.execute('SELECT * FROM users WHERE id = ?', [req.session.user.id]);
        res.render('users/profile', { user: user[0] });
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error loading profile');
        res.redirect('/');
    }
});

// Pending verifications (admin only)
router.get('/pending-verifications', isAdmin, async (req, res) => {
    try {
        const [pendingUsers] = await db.query(
            'SELECT * FROM users WHERE is_verified = FALSE ORDER BY created_at DESC'
        );
        res.render('users/pending-verifications', { pendingUsers });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while fetching pending verifications');
        res.redirect('/');
    }
});

// Verify user (admin only)
router.post('/verify/:id', isAdmin, async (req, res) => {
    try {
        await db.query('UPDATE users SET is_verified = TRUE WHERE id = ?', [req.params.id]);
        req.flash('success_msg', 'User has been verified successfully');
        res.redirect('/users/pending-verifications');
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while verifying user');
        res.redirect('/users/pending-verifications');
    }
});

// Reject user (admin only)
router.post('/reject/:id', isAdmin, async (req, res) => {
    try {
        await db.query('DELETE FROM users WHERE id = ?', [req.params.id]);
        req.flash('success_msg', 'User has been rejected and removed');
        res.redirect('/users/pending-verifications');
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while rejecting user');
        res.redirect('/users/pending-verifications');
    }
});

// Change Password
router.get('/change-password', isAuthenticated, (req, res) => {
    res.render('users/change-password');
});

router.post('/change-password', isAuthenticated, async (req, res) => {
    try {
        const { currentPassword, newPassword, confirmPassword } = req.body;
        
        // Validate passwords
        if (newPassword !== confirmPassword) {
            req.flash('error_msg', 'New passwords do not match');
            return res.redirect('/users/change-password');
        }

        // Get user from database
        const [users] = await db.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
        const user = users[0];

        // Check current password
        const isMatch = await bcrypt.compare(currentPassword, user.password);
        if (!isMatch) {
            req.flash('error_msg', 'Current password is incorrect');
            return res.redirect('/users/change-password');
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // Update password
        await db.query('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, req.user.id]);

        req.flash('success_msg', 'Password changed successfully');
        res.redirect('/users/profile');
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while changing password');
        res.redirect('/users/change-password');
    }
});

// Forgot Password
router.get('/forgot-password', (req, res) => {
    res.render('users/forgot-password');
});

router.post('/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        // Check if user exists
        const [users] = await db.query('SELECT * FROM users WHERE email = ?', [email]);
        if (users.length === 0) {
            req.flash('error_msg', 'No account found with that email address');
            return res.redirect('/users/forgot-password');
        }

        // Generate reset token
        const resetToken = crypto.randomBytes(20).toString('hex');
        const resetExpires = new Date(Date.now() + 3600000); // 1 hour from now

        // Save reset token to database
        await db.query(
            'UPDATE users SET reset_token = ?, reset_expires = ? WHERE email = ?',
            [resetToken, resetExpires, email]
        );

        // Send reset email
        const resetUrl = `${req.protocol}://${req.get('host')}/users/reset-password/${resetToken}`;
        const mailOptions = {
            from: 'nguyenvanhoitgm@gmail.com',
            to: email,
            subject: 'Password Reset Request',
            html: `
                <p>You requested a password reset</p>
                <p>Click this <a href="${resetUrl}">link</a> to reset your password.</p>
                <p>This link will expire in 1 hour.</p>
                <p>If you didn't request this, please ignore this email.</p>
            `
        };

        await transporter.sendMail(mailOptions);

        req.flash('success_msg', 'Password reset instructions have been sent to your email');
        res.redirect('/users/login');
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while processing your request');
        res.redirect('/users/forgot-password');
    }
});

// Reset Password
router.get('/reset-password/:token', async (req, res) => {
    try {
        const [users] = await db.query(
            'SELECT * FROM users WHERE reset_token = ? AND reset_expires > NOW()',
            [req.params.token]
        );

        if (users.length === 0) {
            req.flash('error_msg', 'Password reset token is invalid or has expired');
            return res.redirect('/users/forgot-password');
        }

        res.render('users/reset-password', { token: req.params.token });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while processing your request');
        res.redirect('/users/forgot-password');
    }
});

router.post('/reset-password/:token', async (req, res) => {
    try {
        const { password, confirmPassword } = req.body;

        // Validate passwords
        if (password !== confirmPassword) {
            req.flash('error_msg', 'Passwords do not match');
            return res.redirect(`/users/reset-password/${req.params.token}`);
        }

        // Get user with valid token
        const [users] = await db.query(
            'SELECT * FROM users WHERE reset_token = ? AND reset_expires > NOW()',
            [req.params.token]
        );

        if (users.length === 0) {
            req.flash('error_msg', 'Password reset token is invalid or has expired');
            return res.redirect('/users/forgot-password');
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Update password and clear reset token
        await db.query(
            'UPDATE users SET password = ?, reset_token = NULL, reset_expires = NULL WHERE id = ?',
            [hashedPassword, users[0].id]
        );

        req.flash('success_msg', 'Your password has been reset successfully');
        res.redirect('/users/login');
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while resetting your password');
        res.redirect('/users/forgot-password');
    }
});

// Get all users (admin only)
router.get('/', isAdmin, async (req, res) => {
    try {
        const { search, sort } = req.query;
        let query = 'SELECT * FROM users';
        const params = [];

        // Add search condition if search parameter exists
        if (search) {
            query += ' WHERE email LIKE ?';
            params.push(`%${search}%`);
        }

        // Add sorting
        if (sort === 'asc') {
            query += ' ORDER BY full_name ASC';
        } else if (sort === 'desc') {
            query += ' ORDER BY full_name DESC';
        } else {
            query += ' ORDER BY created_at DESC';
        }

        const [users] = await db.query(query, params);
        res.render('users/index', { 
            users,
            search: search || '',
            sort: sort || ''
        });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while fetching users');
        res.redirect('/');
    }
});

// View user profile by ID (admin only)
router.get('/profile/:id', isAdmin, async (req, res) => {
    try {
        const [users] = await db.query(`
            SELECT 
                id,
                username,
                email,
                full_name,
                role,
                student_id,
                lecturer_id,
                id_card_image,
                is_verified,
                created_at
            FROM users 
            WHERE id = ?
        `, [req.params.id]);

        if (users.length === 0) {
            req.flash('error_msg', 'User not found');
            return res.redirect('/users');
        }

        const user = users[0];
        res.render('users/profile-detail', { user });
    } catch (err) {
        console.error(err);
        req.flash('error_msg', 'An error occurred while fetching user details');
        res.redirect('/users');
    }
});

module.exports = router; 