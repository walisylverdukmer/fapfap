module.exports = (...roles) => (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
        return res.status(403).json({
            msg: `Accès refusé. Rôles autorisés : ${roles.join(', ')}.`
        });
    }
    next();
};
