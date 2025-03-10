

//This version should reduce TTFB significantly, likely in the 150-250ms range, depending on the database and network latency
const createOrder = asyncHandler(async (req, res) => {
    const { products, DiscountCoupon, paymentType, shippingAddress } = req.body;
    const userId = req.user._id;

    // Fetch user and products in parallel
    const [userExist, productsExist] = await Promise.all([
        User.findById(userId).select('_id').lean(),
        Product.find({ _id: { $in: products.map(({ product }) => product) } })
            .select('_id price stock name')
            .lean(),
    ]);

    if (!userExist) {
        return res.status(404).json({ message: 'User not found' });
    }

    if (productsExist.length !== products.length) {
        return res.status(404).json({ message: 'Some products were not found' });
    }

    // Map products for validation
    const productMap = new Map(productsExist.map(p => [p._id.toString(), p]));
    let totalAmount = 0;
    const bulkUpdates = [];

    for (const { product, quantity } of products) {
        const productDetail = productMap.get(product);

        if (!productDetail || productDetail.stock < quantity) {
            return res.status(400).json({ message: `${productDetail?.name || 'Unknown product'} is out of stock` });
        }

        totalAmount += quantity * productDetail.price;

        // Prepare bulk update for stock decrement and order count increment
        bulkUpdates.push({
            updateOne: {
                filter: { _id: product },
                update: { $inc: { stock: -quantity, totalOrders: quantity } },
            },
        });
    }

    // Update products stock and order count
    await Product.bulkWrite(bulkUpdates);

    // Handle coupon (if provided)
    let finalAmount = totalAmount;
    let discount = 0;

    if (DiscountCoupon) {
        const couponExist = await Coupon.findOne({
            code: DiscountCoupon,
            isActive: true,
            expiryDate: { $gt: Date.now() },
        }).select('discountType discountValue minimumPurchase maximumDiscount usageLimit usageCount').lean();

        if (!couponExist) {
            return res.status(400).json({ message: 'Invalid or expired coupon' });
        }

        if (couponExist.minimumPurchase > totalAmount || 
            (couponExist.usageLimit && couponExist.usageCount >= couponExist.usageLimit)) {
            return res.status(400).json({ message: 'Coupon not applicable for this order' });
        }

        discount =
            couponExist.discountType === 'percentage'
                ? Math.min((couponExist.discountValue / 100) * totalAmount, couponExist.maximumDiscount || Infinity)
                : couponExist.discountValue;

        finalAmount -= discount;

        // Increment coupon usage asynchronously
        Coupon.updateOne({ code: DiscountCoupon }, { $inc: { usageCount: 1 } }).exec();
    }

    // Create Razorpay order and database order in parallel
    const [razorpayOrder, order] = await Promise.all([
        razorpay.orders.create({
            amount: Math.round(finalAmount * 100), // Convert to paise
            currency: 'INR',
            receipt: `order_rcptid_${Date.now()}`,
            payment_capture: 0,
        }),
        Order.create({
            user: userId,
            products,
            totalAmount,
            discount,
            finalAmount,
            coupon: DiscountCoupon || null,
            paymentType,
            shippingAddress,
            orderId: `order_${Date.now()}`,
        }),
    ]);

    // Background updates (non-blocking)
    Promise.all([
        User.updateOne({ _id: userId }, { $push: { orders: order._id } }).exec(),
        Product.updateMany(
            { _id: { $in: products.map(({ product }) => product) } },
            { $push: { orderby: userId } }
        ).exec(),
    ]);

    // Respond quickly with minimal payload
    res.status(201).json({
        success: true,
        orderId: order._id,
        razorpayOrderId: razorpayOrder.id,
        message: 'Order created successfully',
    });
});
