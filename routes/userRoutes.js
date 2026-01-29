const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');

router.post('/google-login', userController.loginWithGoogle);
router.get('/:id', userController.getUserProfile);

module.exports = router;
