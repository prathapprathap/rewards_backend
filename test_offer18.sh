#!/bin/bash

# Offer18 Postback Test Script
# This script simulates postback calls from Offer18 to test the integration

# Configuration
BASE_URL="http://localhost:3000/api/offer18"
echo "🧪 Testing Offer18 Integration"
echo "================================"
echo ""

# Test 1: Track a click
echo "Test 1: Track Offer Click"
echo "--------------------------"
CLICK_RESPONSE=$(curl -s -X POST "$BASE_URL/track-click" \
  -H "Content-Type: application/json" \
  -d '{
    "userId": 1,
    "offerId": 1,
    "deviceId": "test-device-123"
  }')

echo "Response: $CLICK_RESPONSE"
CLICK_ID=$(echo $CLICK_RESPONSE | grep -o '"clickId":"[^"]*' | cut -d'"' -f4)
echo "Click ID: $CLICK_ID"
echo ""

# Test 2: Simulate postback (if we got a click_id)
if [ ! -z "$CLICK_ID" ]; then
  echo "Test 2: Simulate Postback from Offer18"
  echo "---------------------------------------"
  
  POSTBACK_RESPONSE=$(curl -s "$BASE_URL/postback?clickid=$CLICK_ID&payout=50&status=approved&event=signup&offerid=1")
  
  echo "Postback Response: $POSTBACK_RESPONSE"
  echo ""
fi

# Test 3: Get wallet breakdown
echo "Test 3: Get Wallet Breakdown"
echo "-----------------------------"
WALLET_RESPONSE=$(curl -s "$BASE_URL/wallet/1")
echo "Wallet: $WALLET_RESPONSE"
echo ""

# Test 4: Get transaction history
echo "Test 4: Get Transaction History"
echo "--------------------------------"
TRANSACTIONS=$(curl -s "$BASE_URL/transactions/1?limit=10")
echo "Transactions: $TRANSACTIONS"
echo ""

# Test 5: Get click history
echo "Test 5: Get Click History"
echo "-------------------------"
CLICKS=$(curl -s "$BASE_URL/clicks/1")
echo "Clicks: $CLICKS"
echo ""

# Test 6: Get conversion analytics (admin)
echo "Test 6: Get Conversion Analytics"
echo "---------------------------------"
ANALYTICS=$(curl -s "$BASE_URL/analytics/conversions")
echo "Analytics: $ANALYTICS"
echo ""

echo "✅ All tests completed!"
echo ""
echo "📝 Check the following:"
echo "  - Backend logs for processing details"
echo "  - Database tables: offer_clicks, offer_events, postback_logs, wallet_transactions"
echo "  - User wallet balance should have increased if postback was successful"
