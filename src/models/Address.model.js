import mongoose from "mongoose";


const AddressSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    FullName: {
        type: String,
        required: true
    },
    MobileNumber: {
        type: Number,
        required: true
    },
    CompanyName: {
        type: String,
    },
    Address: {
        type: String,
        required: true
    },
    City: {
        type: String,
        required: true
    },
    State: {
        type: String,
        required: true
    },
    Pincode: {
        type: Number,
        required: true
    },
    Country :{
        type: String,
        required: true
    },
    GSTIN:{
        type: String,
        
    },
    isDefault: {
        type: Boolean,
        default: false
    }
    }, {
    timestamps: true
});


const Address = mongoose.model('Address', AddressSchema);

export default Address;