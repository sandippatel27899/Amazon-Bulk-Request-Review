document.getElementById("startBtn").addEventListener("click", async function () {
    console.log("Button clicked!");
    const resultDiv = document.getElementById("result");
    resultDiv.style.display = "none"; // Clear previous result

    resultDiv.classList.remove("success", "error");

    // Initialize counters for success and failure
    let successCount = 0;
    let failureCount = 0;

    chrome.tabs.query({ active: true, currentWindow: true }, async function (tabs) {
        const activeTab = tabs[0];
        chrome.cookies.getAll({ url: activeTab.url }, async function (cookies) {
            let cookieString = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');

            const marketplaceId = await fetchMarketplaceId(cookieString);
            if (!marketplaceId) {
                resultDiv.textContent = "Error: Could not fetch marketplace ID.";
                resultDiv.classList.add("error");
                resultDiv.style.display = "block";
                return;
            }

            const requestResult = await makeBulkRequests(cookieString, marketplaceId, successCount, failureCount);
            successCount = requestResult.successCount;
            failureCount = requestResult.failureCount;

            // Show success result with counters
            resultDiv.textContent = `All requests completed successfully! Success: ${successCount}, Failed: ${failureCount}`;
            resultDiv.classList.add("success");
            resultDiv.style.display = "block";
        });
    });
});


async function fetchMarketplaceId(cookieString) {
    const headers = {
        'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'cookie': cookieString
    };

    try {
        const response = await fetch('https://sellercentral.amazon.in/home', {
            method: 'GET',
            headers: headers
        });

        const text = await response.text();
        const marketplaceId = text.split('"marketplaceId":"')[1].split('"')[0];
        console.log("Marketplace ID:", marketplaceId);
        return marketplaceId;
    } catch (error) {
        console.error("Error fetching marketplace ID:", error);
        return null;
    }
}

async function makeBulkRequests(cookieString, marketplaceId) {
    const headers = {
        'accept': 'application/json',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'cookie': cookieString
    };

    const params = new URLSearchParams({
        'limit': '3',
        'offset': '0',
        'sort': 'ship_by_desc',
        'date-range': 'last-30',
        'fulfillmentType': 'seller',
        'orderStatus': 'all',
        'forceOrdersTableRefreshTrigger': 'false'
    });

    const ordersResponse = await fetch(`https://sellercentral.amazon.in/orders-api/search?${params}`, {
        method: 'GET',
        headers: headers
    });

    const ordersData = await ordersResponse.json();
    let orderNumbers = [];
    ordersData.orders.forEach(order => {
        orderNumbers.push(order.sellerOrderId || order.amazonOrderId);
    });

    let successCount = 0;
    let failureCount = 0;

    const totalOrders = orderNumbers.length;
    if (totalOrders === 0) {
        console.log("No orders to process.");
        return;
    }

    // Show the progress bar
    const progressContainer = document.getElementById("progressContainer");
    const progressBar = document.getElementById("progressBar");
    const progressPercentage = document.getElementById("progressPercentage");
    progressContainer.style.display = "block";

    let processedOrders = 0;

    // Update progress bar for each processed order
    for (let orderNumber of orderNumbers) {
        const result = await sendReviewRequest(orderNumber, cookieString, headers, marketplaceId);
        if (result === 'success') {
            successCount++;
        } else {
            failureCount++;
        }
    }

    return { successCount, failureCount };
}



async function sendReviewRequest(orderNumber, cookieString, headers, marketplaceId) {
    const params = new URLSearchParams({
        'marketplaceId': marketplaceId,
        'isReturn': 'false'
    });

    const updatedHeaders = {
        ...headers,
        'Content-Type': 'application/json',
        'x-requested-with': '',
        'x-resource-version': ''
    };

    const url = `https://sellercentral.amazon.in/messaging/api/solicitations/${orderNumber}/productReviewAndSellerFeedback?${params}`;
    
    console.log('Sending request:', {
        url,
        method: 'POST',
        headers: updatedHeaders,
        body: '{}'
    });
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: updatedHeaders,
            body: '{}'
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
        }

        const responseText = await response.text();
        console.log(`Response for order ${orderNumber}:`, responseText);

        let jsonResponse;
        try {
            jsonResponse = JSON.parse(responseText);
        } catch (parseError) {
            console.error(`Failed to parse JSON for order ${orderNumber}:`, responseText);
            return 'failure';
        }

        if (jsonResponse.isSuccess) {
            return 'success';
        } else {
            console.error(orderNumber, " -- ", jsonResponse.ineligibleReason);
            return 'failure';
        }

    } catch (error) {
        console.error(`Error processing order ${orderNumber}:`, error.message);
        return 'failure';
    }
}
