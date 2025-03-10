import Address from "../models/Address.model.js";
import User from '../models/User.model.js';
import {asyncHandler} from '../utils/asyncHandler.js';
import {ApiResponse} from '../utils/ApiResponse.js';
import redisClient from "../db/Radis.db.js";



// Create and Save a new Address 

const addrescreate = asyncHandler(async (req, res) => {
    try {
        if (!req.body) {
            return res.status(400).json(new ApiResponse(400, null, "Content cannot be empty!"));
        }


        // Ensure user is authenticated
        if (!req.user || !req.user._id) {
            return res.status(401).json(new ApiResponse(401, null, "Unauthorized"));
        }

        const address = new Address({
            user: req.user._id,
            FullName: req.body.FullName,
            MobileNumber: Number(req.body.MobileNumber),
            CompanyName: req.body.CompanyName,
            Address: req.body.Address,
            City: req.body.City,
            State: req.body.State,
            Pincode: Number(req.body.Pincode),
            Country: req.body.Country,
            GSTIN: req.body.GSTIN,
            isDefault: req.body.isDefault
        });

        console.log("✅ Address to be saved:", address);

        // Save to DB
        const data = await address.save();
        console.log("✅ Address saved successfully:", data);

        // Add address reference to user
        const user = await User.findByIdAndUpdate(
            req.user._id,
            { $push: { shippingAddress: data._id } },
            { new: true, useFindAndModify: false }
        );

        if (!user) {
            return res.status(404).json(new ApiResponse(404, null, "User not found"));
        }

        // Clear Redis cache
        const cacheKey = `user:${req.user._id}:shippingAddress`;
        try {
            await redisClient.del(cacheKey);
            console.log(`✅ Redis cache cleared for user ${req.user._id}`);
        } catch (redisError) {
            console.error("❌ Redis Cache Deletion Error:", redisError.message);
        }

        res.status(200).json(new ApiResponse(200, data, "Address created successfully"));
    } catch (error) {
        console.error("❌ Address Creation Error:", error.message);
        res.status(500).json(new ApiResponse(500, null, error.message || "Internal server error"));
    }
});
// Update an address identified by the addressId in the request
const updateUserAddress = asyncHandler(async (req, res) => {
    const userId = req.user._id.toString();
    const { addressId} = req.params;
    const { newAddress } = req.body;

    try {
        // ✅ Find the user first
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json(new ApiResponse(404, null, "User not found"));
        }

        // ✅ Ensure the address exists
        const address = await Address.findOne({ _id: addressId, user: userId });
        if (!address) {
            return res.status(404).json(new ApiResponse(404, null, "Address not found"));
        }
              
        // ✅ Update the address properly
        await Address.findByIdAndUpdate(addressId, { $set: newAddress }, { new: true });

        // ✅ Clear Redis cache
        await redisClient.del(`user:${userId}:shippingAddress`);
        console.log(`✅ Redis cache cleared for user ${userId} after address update`);

        res.status(200).json(new ApiResponse(200, newAddress, "Address updated successfully"));
    } catch (error) {
        console.error("Error updating address:", error);
        res.status(500).json(new ApiResponse(500, null, "Server Error"));
    }
});

// Delete an address with the specified addressId in the request
const deleteUserAddress = asyncHandler(async (req, res) => {
    try {
        const userId = req.user?._id?.toString();
        const { addressId } = req.params;

        if (!userId) {
            return res.status(401).json(new ApiResponse(401, null, "Unauthorized"));
        }

        console.log(`📌 Deleting address: ${addressId} for user: ${userId}`);

        // ✅ Check if user exists
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json(new ApiResponse(404, null, "User not found"));
        }

        // ✅ Check if the address exists & belongs to the user
        const address = await Address.findOne({ _id: addressId, user: userId });
        if (!address) {
            return res.status(404).json(new ApiResponse(404, null, "Address not found"));
        }

        // ✅ Delete the address
        const deletedAddress = await Address.findByIdAndDelete(addressId);
        if (!deletedAddress) {
            return res.status(404).json(new ApiResponse(404, null, "Address not found or already deleted"));
        }

        // ✅ Remove address from user's shippingAddress array
        await User.findByIdAndUpdate(userId, { $pull: { shippingAddress: addressId } });

        // ✅ Clear Redis cache
        try {
            await redisClient.del(`user:${userId}:shippingAddress`);
            console.log(`✅ Redis cache cleared for user ${userId}`);
        } catch (redisError) {
            console.error("❌ Redis Cache Deletion Error:", redisError.message);
        }

        return res.status(200).json(new ApiResponse(200, null, "Address deleted successfully"));
    } catch (error) {
        console.error("❌ Error deleting address:", error.message);
        return res.status(500).json(new ApiResponse(500, null, "Server Error"));
    }
});



// user all saved address get

const useralladdress = asyncHandler(async (req, res) => {
    const userId = req.user._id.toString();
    const cacheKey = `user:${userId}:shippingAddress`; // Define the Redis cache key

    try {
        // Check if data exists in Redis cache
        const cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
            console.log("✅ Cache hit, returning cached addresses");
            return res.status(200).json(new ApiResponse(200, JSON.parse(cachedData), "All Address (Cached)"));
        }

        // Fetch the user and populate the shipping address if not cached
        const userShippingAddresses = await User.findById(userId)
            .populate({
                path: 'shippingAddress',
                select: 'FullName MobileNumber CompanyName Address City State Pincode Country GSTIN isDefault', // Fetch necessary fields
            })
            .lean(); // Use lean to return plain objects for better performance

        // If no addresses found, return an empty array
        if (!userShippingAddresses || !userShippingAddresses.shippingAddress) {
            return res.status(404).json(new ApiResponse(404, [], "No Address found"));
        }

        // Cache the result in Redis with an expiry (e.g., 1 hour)
        await redisClient.setEx(cacheKey, 3600, JSON.stringify(userShippingAddresses.shippingAddress));

        // Return the fresh data
        res.status(200).json(new ApiResponse(200, userShippingAddresses.shippingAddress, "All Address (Fresh)"));
    } catch (error) {
        console.error("Error fetching addresses:", error);
        res.status(500).json(new ApiResponse(500, null, "Server Error"));
    }
});






export {addrescreate,useralladdress ,updateUserAddress,deleteUserAddress};