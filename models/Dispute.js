const mongoose = require('mongoose');

const disputeSchema = new mongoose.Schema({
    disputeNumber: {
        type: String,
        unique: true
    },

    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    order: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Order',
        required: true
    },
    transaction: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Transaction'
    },
    event: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Event',
        required: true
    },

    type: {
        type: String,
        enum: [
            'refund_request',
            'double_charge',
            'unauthorized',
            'event_cancelled',
            'service_issue',
            'ticket_not_received',
            'other'
        ],
        required: true
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'urgent'],
        default: 'medium'
    },

    // Status workflow
    status: {
        type: String,
        enum: ['open', 'investigating', 'pending_user', 'resolved', 'rejected', 'escalated'],
        default: 'open'
    },

    // Dispute details
    subject: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        required: true
    },
    amount: {
        type: Number,
        required: true
    },

    resolution: {
        type: {
            type: String,
            enum: ['full_refund', 'partial_refund', 'no_refund', 'replacement', 'credit']
        },
        refundAmount: { type: Number, default: 0 },
        notes: { type: String },
        resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        resolvedAt: { type: Date }
    },

    rejection: {
        reason: { type: String },
        rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        rejectedAt: { type: Date }
    },

    messages: [{
        sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        senderRole: { type: String, enum: ['buyer', 'organizer', 'validator', 'admin', 'system'] },
        message: { type: String, required: true },
        attachments: [{ type: String }],
        createdAt: { type: Date, default: Date.now }
    }],

    evidence: [{
        type: { type: String }, // screenshot, receipt, email, etc.
        url: { type: String },
        description: { type: String },
        uploadedAt: { type: Date, default: Date.now }
    }],

    assignedTo: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },

    timeline: [{
        action: { type: String },
        actor: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        details: { type: String },
        createdAt: { type: Date, default: Date.now }
    }],

    // SLA tracking
    sla: {
        responseDeadline: { type: Date },
        resolutionDeadline: { type: Date },
        isBreached: { type: Boolean, default: false }
    },

    // Metadata
    metadata: {
        ipAddress: { type: String },
        userAgent: { type: String }
    }

}, { timestamps: true });

disputeSchema.index({ disputeNumber: 1 });
disputeSchema.index({ user: 1, createdAt: -1 });
disputeSchema.index({ status: 1, priority: -1 });
disputeSchema.index({ assignedTo: 1, status: 1 });
disputeSchema.index({ event: 1 });
disputeSchema.index({ createdAt: -1 });


disputeSchema.pre('save', async function(next) {
    if (!this.disputeNumber) {
        const count = await this.constructor.countDocuments();
        const year = new Date().getFullYear();
        this.disputeNumber = `DSP-${year}-${String(count + 1).padStart(6, '0')}`;
    }
    next();
});

disputeSchema.methods.addTimelineEntry = function(action, actor, details) {
    this.timeline.push({ action, actor, details });
    return this.save();
};

disputeSchema.methods.addMessage = function(sender, senderRole, message, attachments = []) {
    this.messages.push({ sender, senderRole, message, attachments });
    return this.save();
};

disputeSchema.statics.getByPriority = function(status = 'open') {
    return this.find({ status })
        .sort({ priority: -1, createdAt: 1 })
        .populate('user', 'fullName email')
        .populate('order')
        .populate('event', 'title');
};

module.exports = mongoose.model('Dispute', disputeSchema);
