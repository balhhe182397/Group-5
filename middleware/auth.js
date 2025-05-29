const isAuthenticated = (req, res, next) => {
    if (req.session.user) {
        return next();
    }
    req.flash('error_msg', 'Please log in to access this page');
    res.redirect('/users/login');
};

const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    }
    req.flash('error_msg', 'Access denied. Admin privileges required.');
    res.redirect('/');
};

const isLibrarian = (req, res, next) => {
    if (req.session.user && (req.session.user.role === 'admin' || req.session.user.role === 'librarian')) {
        return next();
    }
    req.flash('error_msg', 'Access denied. Librarian privileges required.');
    res.redirect('/');
};

module.exports = {
    isAuthenticated,
    isAdmin,
    isLibrarian
}; 