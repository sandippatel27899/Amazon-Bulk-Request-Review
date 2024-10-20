document.getElementById("startBtn").addEventListener("click", async function () {
    console.log("Button clicked!");
    const resultDiv = document.getElementById("result");
    const progressContainer = document.getElementById("progressContainer");
    const progressBar = document.getElementById("progressBar");
    const progressPercentage = document.getElementById("progressPercentage");

    // Get input values
    const limit = document.getElementById("limit").value;
    const offset = document.getElementById("offset").value;
    const fulfillmentType = document.getElementById("fulfillmentType").value;
    const startDate = document.getElementById("startDate").value;
    const endDate = document.getElementById("endDate").value;

    // Convert dates to epoch time
    const startEpoch = new Date(startDate).getTime();
    const endEpoch = new Date(endDate).getTime();

    // Clear previous result
    resultDiv.style.display = "none";

    // Reset progress
    progressBar.value = 0;
    progressPercentage.textContent = "0%";
    progressContainer.style.display = "block";

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

            const requestResult = await makeBulkRequests(cookieString, marketplaceId, progressBar, progressPercentage, limit, offset, fulfillmentType,  startEpoch, endEpoch);

                    // Show detailed result with counters in a single box
                    resultDiv.innerHTML = `
                        <div>
                            <h3 style="margin-top: 0; color: #333;">Request Results:</h3>
                            <p style="margin: 5px 0;"><strong>Total:</strong> ${requestResult.total}</p>
                            <p style="margin: 5px 0;"><strong>Success:</strong> ${requestResult.successCount}</p>
                            <p style="margin: 5px 0;"><strong>Failed:</strong> ${requestResult.failureCount}</p>
                            <p style="margin: 5px 0;"><strong>Already Sent:</strong> ${requestResult.alreadySentCount}</p>
                            <p style="margin: 5px 0;"><strong>Outside Time Window:</strong> ${requestResult.outsideTimeWindowCount}</p>
                        </div>
                    `;
                    resultDiv.style.display = "block";

            // Hide progress bar once the requests are completed
                    progressContainer.style.display = "none";
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

async function makeBulkRequests(cookieString, marketplaceId, progressBar, progressPercentage, limit, offset, fulfillmentType, startEpoch, endEpoch) {
    const headers = {
        'accept': 'application/json',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'cookie': cookieString
    };

    const params = new URLSearchParams({
        'limit': limit,
        'offset': offset,
        'sort': 'ship_by_desc',
        'date-range': `${startEpoch}-${endEpoch}`,
        'fulfillmentType': fulfillmentType,
        'orderStatus': 'all',
        'forceOrdersTableRefreshTrigger': 'false'
    });

    try {
        const ordersResponse = await fetch(`https://sellercentral.amazon.in/orders-api/search?${params}`, {
            method: 'GET',
            headers: headers
        });

        // Check if the response is not OK
        if (!ordersResponse.ok) {
            console.error(`Error fetching orders: ${ordersResponse.status} ${ordersResponse.statusText}`);
            return {
                total: 0,
                successCount: 0,
                failureCount: 0,
                alreadySentCount: 0,
                outsideTimeWindowCount: 0
            };
        }

        const ordersData = await ordersResponse.json();
        let orderNumbers = ordersData.orders.map(order => order.sellerOrderId || order.amazonOrderId);

        // Check if no orders were found
        if (orderNumbers.length === 0) {
            return {
                total: 0,
                successCount: 0,
                failureCount: 0,
                alreadySentCount: 0,
                outsideTimeWindowCount: 0,
                message: "There are no orders in this criteria. Please select valid criteria."
            };
        }

        let successCount = 0;
        let failureCount = 0;
        let alreadySentCount = 0;
        let outsideTimeWindowCount = 0;


        const totalOrders = orderNumbers.length;
    if (totalOrders === 0) {
        console.log("No orders to process.");
        return;
    }

        let processedOrders = 0;


        for (let orderNumber of orderNumbers) {
            const result = await sendReviewRequest(orderNumber, cookieString, headers, marketplaceId);
            if (result === 'success') {
                successCount++;
        } else if (result === 'REVIEW_REQUEST_ALREADY_SENT') {
                alreadySentCount++;
            } else if (result === 'REVIEW_REQUEST_OUTSIDE_TIME_WINDOW') {
                outsideTimeWindowCount++;
            } else {
                failureCount++;
            }

            // Update progress bar
            processedOrders++;
            const progress = (processedOrders / totalOrders) * 100;
            progressBar.value = progress;
            progressPercentage.textContent = `${Math.round(progress)}%`;
        }

        return {
            total: orderNumbers.length,
            successCount,
            failureCount,
            alreadySentCount,
            outsideTimeWindowCount
        };
    } catch (error) {
        console.info("Error in makeBulkRequests:", error);
        return {
            total: 0,
            successCount: 0,
            failureCount: 0,
            alreadySentCount: 0,
            outsideTimeWindowCount: 0
        };
    }
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
        } else if (jsonResponse.ineligibleReason === 'REVIEW_REQUEST_ALREADY_SENT') {
            return 'REVIEW_REQUEST_ALREADY_SENT';
        } else if (jsonResponse.ineligibleReason === 'REVIEW_REQUEST_OUTSIDE_TIME_WINDOW') {
            return 'REVIEW_REQUEST_OUTSIDE_TIME_WINDOW';
        } else {
            console.error(orderNumber, " -- ", jsonResponse.ineligibleReason);
            return 'failure';
        }

    } catch (error) {
        console.error(`Error processing order ${orderNumber}:`, error.message);
        return 'failure';
    }
}
