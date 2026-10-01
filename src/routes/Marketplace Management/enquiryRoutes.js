const express = require('express')
const ctrl = require('../../controllers/Marketplace Management/enquiryController')
const retailerMarketplace = require('../../controllers/Retailer Management/retailerMarketplaceController')
const { requireApprovedSeller } = require('../../middleware/retailerAccess')
const { validateObjectIdParam } = require('../../middleware/validateObjectId')

const router = express.Router()
router.param('id', validateObjectIdParam('id'))

router.get('/stats', ctrl.enquiryStats)
router.get('/', ctrl.listEnquiries)
router.post('/', ctrl.createEnquiry)

// Seller-side offer creation stays seller-only: only a seller quotes, and the
// buyer never creates offers, so this guard is safe to keep.
router.post('/:id/offers', requireApprovedSeller, retailerMarketplace.sellerCreateOffer)

// Offer + message read/write — unified so a SENDER (Retailer / broadcast owner)
// and an operator (ERP/CRM) can both reach them. `requireApprovedSeller` used to
// 403 the Retailer buyer, which left `offers` empty and hid the entire per-seller
// negotiation UI. listOffers / listMessages / createMessage scope by ownership,
// serving the recipient, the buyer, and operators from one endpoint each.
router.get('/:id/offers', ctrl.listOffers)
router.get('/:id/messages', ctrl.listMessages)
router.post('/:id/messages', ctrl.createMessage)

// Who answered a broadcast (and who has not). Registered before `/:id` for
// clarity — the paths cannot actually collide, since `:id` matches one segment.
router.get('/:id/replies', ctrl.enquiryReplies)
router.get('/:id/reply-history', ctrl.listReplyHistory)
router.post('/:id/reply-history', ctrl.createReplyHistory)

router.get('/:id', ctrl.getEnquiry)
router.patch('/:id', ctrl.updateEnquiry)
router.delete('/:id', ctrl.deleteEnquiry)

module.exports = router
