import express from 'express';
import { getProfile, updateLocation } from '../controllers/UserController.js';
import authMiddleware from '../middleware/authMiddleware.js';
import { deleteAccount } from '../controllers/UserController.js';

const router = express.Router();

// ✅ Get User Profile
router.get('/profile', authMiddleware, getProfile);

// ✅ Update Location Route
router.post('/update-location', authMiddleware, updateLocation);

router.delete('/delete-account', authMiddleware, deleteAccount);

export default router;