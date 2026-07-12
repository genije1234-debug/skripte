// Global flag for auto-sending control
let isAutoSending = false;
let cycleTimeoutId = null;

// Function to add message to bet status box
function addBetStatusMessage(message, type = 'info') {
  const messagesBox = document.getElementById('betStatusMessages');
  if (!messagesBox) return;
  
  const timestamp = new Date().toLocaleTimeString();
  let color = '#666';
  let icon = 'ℹ️';
  
  if (type === 'success') {
    color = '#28a745';
    icon = '✅';
  } else if (type === 'error') {
    color = '#dc3545';
    icon = '❌';
  } else if (type === 'warning') {
    color = '#ffc107';
    icon = '⚠️';
  }
  
  const messageEl = document.createElement('div');
  messageEl.style.marginBottom = '8px';
  messageEl.style.color = color;
  messageEl.style.fontWeight = 'bold';
  messageEl.innerHTML = `[${timestamp}] ${icon} ${message}`;
  
  // Insert at the top (newest first)
  messagesBox.insertBefore(messageEl, messagesBox.firstChild);
}

// Function to send bet
async function sendBet() {
  const stakeInput = document.getElementById('stake1');
  const stakeValue = stakeInput.value;
  
  if (!stakeValue || stakeValue <= 0) {
    addBetStatusMessage('Invalid stake amount', 'error');
    return false;
  }
  
  // Get data from slot
  const result = await new Promise(resolve => {
    chrome.storage.local.get(['slot1Data', 'slot1Details'], resolve);
  });
  
  const slotData = result.slot1Data || [];
  const slotDetails = result.slot1Details || [];
  
  if (slotData.length === 0) {
    addBetStatusMessage('Slot is empty', 'error');
    return false;
  }
  
  // Build live data map
  const liveDataMap = {};
  slotDetails.forEach(detail => {
    if (detail.success && detail.data.markets) {
      detail.data.markets.forEach(market => {
        if (market.selections) {
          market.selections.forEach(selection => {
            liveDataMap[selection.id] = selection.odds;
          });
        }
      });
    }
  });
  
  // Build selections array
  const selections = [];
  for (const odd of slotData) {
    const liveOdds = liveDataMap[odd.marketId];
    selections.push({
      id: parseInt(odd.marketId),
      odds: liveOdds.toString()
    });
  }
  
  // Get active SportPesa tab
  const tabs = await chrome.tabs.query({ url: '*://*.sportpesa.com/*' });
  
  if (!tabs || tabs.length === 0) {
    addBetStatusMessage('No SportPesa tab open', 'error');
    return false;
  }
  
  addBetStatusMessage(`Sending bet with stake: ${stakeValue}...`, 'info');
  
  // Send message to background to place bet
  chrome.runtime.sendMessage({
    type: 'PLACE_BET',
    amount: stakeValue,
    selections: selections,
    tabId: tabs[0].id
  });
  
  return true;
}

// Function to create odd card HTML
function createOddCard(odd, liveData = null, isNotFound = false, slotNumber = null) {
  // Determine styling based on live status
  let cardStyle = 'font-size: 11px;'; // Smaller font
  let statusBadge = '';
  let quotaValue = odd.quota || 'N/A';
  let quotaStyle = '';
  
  // If event not found, add red background
  if (isNotFound) {
    cardStyle = 'font-size: 11px; background: #ffcccc; border: 2px solid #dc3545;';
    statusBadge = `
      <div style="display: inline-block; padding: 3px 8px; background: #dc3545; color: white; border-radius: 10px; font-size: 10px; font-weight: bold; margin-left: 8px;">
        ❌ Not Found
      </div>
    `;
  } else if (liveData) {
    const isOpen = liveData.status && liveData.status.toLowerCase() === 'open';
    const statusIcon = isOpen ? '✅' : '🔒';
    
    // Check if market is NOT Open → red background
    if (!isOpen) {
      cardStyle = 'font-size: 11px; background: #ffcccc; border: 2px solid #dc3545;';
      statusBadge = `
        <div style="display: inline-block; padding: 3px 8px; background: #dc3545; color: white; border-radius: 10px; font-size: 10px; font-weight: bold; margin-left: 8px;">
          🔒 ${liveData.status || 'Closed'}
        </div>
      `;
    } else {
      // Market is Open
      const liveOddsValue = parseFloat(liveData.odds);
      
      // Check if Slot 1 and odds > 1.2
      if (slotNumber === 1 && liveOddsValue > 1.2) {
        // Orange background for Slot 1 when odds > 1.2
        cardStyle = `border: 2px solid #ff8c00; background: #ffe4b3; font-size: 11px;`;
        statusBadge = `
          <div style="display: inline-block; padding: 3px 8px; background: #ff8c00; color: white; border-radius: 10px; font-size: 10px; font-weight: bold; margin-left: 8px;">
            🔥 High Odds
          </div>
        `;
      } else {
        // Normal Open market - green border
        cardStyle = `border: 2px solid #28a745; font-size: 11px;`;
        statusBadge = `
          <div style="display: inline-block; padding: 3px 8px; background: #d4edda; color: #155724; border-radius: 10px; font-size: 10px; font-weight: bold; margin-left: 8px;">
            ✅ Open
          </div>
        `;
      }
    }
    
    // Replace quota with live odds
    quotaValue = liveData.odds;
    quotaStyle = 'font-weight: bold; color: #007bff; font-size: 13px;';
  }
  
  return `
    <div class="odd-card" style="${cardStyle}" data-market-id="${odd.marketId}" data-event-id="${odd.eventId}">
      <div style="display: flex; align-items: flex-start; justify-content: space-between; margin-bottom: 6px; height: 32px;">
        <div class="odd-card-header" style="flex: 1; font-size: 12px; line-height: 16px; height: 32px; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">${odd.eventName || 'N/A'}</div>
        ${statusBadge}
      </div>
      <div class="odd-card-row" style="font-size: 10px; display: none;">
        <span class="odd-card-label">Event ID:</span>
        <span class="odd-card-value">${odd.eventId || 'N/A'}</span>
      </div>
      <div class="odd-card-row" style="font-size: 10px; display: none;">
        <span class="odd-card-label">Market ID:</span>
        <span class="odd-card-value">${odd.marketId || 'N/A'}</span>
      </div>
      <div class="odd-card-row" style="font-size: 10px; display: none;">
        <span class="odd-card-label">Sport:</span>
        <span class="odd-card-value">${odd.sportName || 'N/A'}</span>
      </div>
      <div class="odd-card-row" style="font-size: 10px;">
        <span class="odd-card-label">Market:</span>
        <span>${odd.categoryName || 'N/A'}</span>
      </div>
      <div class="odd-card-row" style="font-size: 10px;">
        <span class="odd-card-label">Your Pick:</span>
        <span style="font-weight: bold; color: #0066cc;">${odd.yourPick || 'N/A'}</span>
      </div>
      <div class="odd-card-row" style="font-size: 10px;">
        <span class="odd-card-label">Quota:</span>
        <span class="quota-value" style="${quotaStyle}">${quotaValue}</span>
      </div>
    </div>
  `;
}

// Track single slot state: 'idle', 'recording', 'saved'
let slotState = 'idle';

// Load slot state from storage on startup
chrome.storage.local.get(['slotState'], (result) => {
  if (result.slotState) {
    slotState = result.slotState;
    updateSlotUI();
  }
});

// Function to update slot UI based on state
function updateSlotUI() {
  const container = document.getElementById('mainSlot');
  const status = container.querySelector('.slot-status');
  
  // Remove all state classes
  container.classList.remove('recording', 'saved');
  
  // Update based on state
  if (slotState === 'recording') {
    container.classList.add('recording');
    status.textContent = 'Recording';
  } else if (slotState === 'saved') {
    container.classList.add('saved');
    status.textContent = 'Saved';
  } else {
    status.textContent = 'Idle';
  }
}

// Set slot state
function setSlotState(state) {
  slotState = state;
  chrome.storage.local.set({ slotState: slotState });
  updateSlotUI();
}

// Add click listeners to NEW button
document.querySelectorAll('.new-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    setSlotState('recording');
  });
});

// Add click listeners to SAVE button
document.querySelectorAll('.save-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    setSlotState('saved');
  });
});

// Add click listeners to CLEAR button
document.querySelectorAll('.clear-slot-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    chrome.storage.local.set({ slot1Data: [] }, () => {
      setSlotState('idle');
      loadSlotData();
    });
  });
});

// START button - starts auto-sending loop
document.getElementById('startBtn').addEventListener('click', async () => {
  if (isAutoSending) {
    addBetStatusMessage('Already running', 'warning');
    return;
  }
  
  isAutoSending = true;
  addBetStatusMessage('AUTO-SENDING STARTED', 'success');
  console.log('🚀 START clicked - Auto-sending enabled');
  
  // Start timer
  startTimerDisplay();
  
  // Send first bet
  await sendBet();
  if (isAutoSending) {
    scheduleNextBet(autoCheckIntervalMs);
  }
});

// STOP button - stops auto-sending loop
document.getElementById('stopBtn').addEventListener('click', () => {
  if (!isAutoSending) {
    addBetStatusMessage('Not running', 'warning');
    return;
  }
  
  isAutoSending = false;
  addBetStatusMessage('AUTO-SENDING STOPPED', 'error');
  console.log('⏹️ STOP clicked - Auto-sending disabled');
  
  if (cycleTimeoutId) {
    clearTimeout(cycleTimeoutId);
    cycleTimeoutId = null;
  }
  
  // Reset timer display
  resetTimerDisplay();
});

// GOL button lock state (timer + market + suspended error conditions)
const golBtn = document.getElementById('golBtn');
let golLockedByTimer = false;
let golLockedByMarket = false;
let golLockedBySuspendedError = false;

function applyGolButtonLockState() {
  if (!golBtn) return;

  const isLocked = golLockedByTimer || golLockedByMarket || golLockedBySuspendedError;
  golBtn.disabled = isLocked;
  golBtn.style.background = isLocked ? '#6c757d' : '#28a745';
  golBtn.style.cursor = isLocked ? 'not-allowed' : 'pointer';

  if (golLockedByTimer) {
    golBtn.title = 'GOL unlocks when timer is under 10 seconds';
  } else if (golLockedBySuspendedError) {
    golBtn.title = 'GOL locked due to suspended market error';
  } else if (golLockedByMarket) {
    golBtn.title = 'GOL locked while market is suspended or not found';
  } else {
    golBtn.title = '';
  }
}

if (golBtn) {
  applyGolButtonLockState();
  console.log('✅ GOL button enabled - ready for SportPesa cashout');
}

function setGolButtonLocked(isLocked) {
  golLockedByTimer = isLocked;
  applyGolButtonLockState();
}

function setGolButtonMarketLocked(isLocked) {
  golLockedByMarket = isLocked;
  applyGolButtonLockState();
}

function setGolButtonSuspendedErrorLocked(isLocked) {
  golLockedBySuspendedError = isLocked;
  applyGolButtonLockState();
}

// GOL button - send cashout using saved data from PROVERI
document.getElementById('golBtn').addEventListener('click', async () => {
  if (golBtn && golBtn.disabled) {
    return;
  }

  console.log('⚽ GOL button clicked - initiating cashout');
  
  try {
    // Get saved cashout data from PROVERI
    const result = await new Promise(resolve => {
      chrome.storage.local.get(['savedCashoutData'], resolve);
    });
    
    if (!result.savedCashoutData) {
      addBetStatusMessage('❌ No cashout data found. Press PROVERI first!', 'error');
      return;
    }
    
    const cashoutData = result.savedCashoutData;
    console.log('Using saved cashout data:', cashoutData);
    
    // Find SportPesa tab
    let tabs = await chrome.tabs.query({ url: '*://www.ke.sportpesa.com/*' });
    if (!tabs || tabs.length === 0) {
      console.log('❌ No SportPesa tab found');
      addBetStatusMessage('No SportPesa tab found', 'error');
      return;
    }
    
    const tabId = tabs[0].id;
    
    // Send cashout command
    addBetStatusMessage(`Sending cashout for bet ${cashoutData.betId}...`, 'info');
    
    chrome.tabs.sendMessage(tabId, {
      type: 'SEND_CASHOUT',
      data: cashoutData
    });
    
    console.log(`📤 Cashout command sent for bet ${cashoutData.betId}`);
    addBetStatusMessage(`✅ Cashout sent: ${cashoutData.totalValueOperation} KES`, 'success');
    
    // AFTER cashout is sent: stop the cycle timer
    if (cycleTimeoutId) {
      clearTimeout(cycleTimeoutId);
      cycleTimeoutId = null;
    }
    stopTimerDisplay();
    
    // THEN: Stop auto-sending cycle
    if (isAutoSending) {
      isAutoSending = false;
      addBetStatusMessage('⚽ Cycle stopped by GOL', 'warning');
    }
    
  } catch (error) {
    console.error('❌ GOL error:', error);
    addBetStatusMessage('Error during cashout', 'error');
  }
});

// SLOT button - opens mines game in new tab
document.getElementById('slotBtn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://mines.turbogg4u.online' });
  console.log('🎰 SLOT clicked - Opening mines game');
});

// Function to check if all selections have live odds and update button state
function updateGoalButtonState() {
  chrome.storage.local.get(['slot1Data', 'slot1Details'], (result) => {
    const slotData = result.slot1Data || [];
    const slotDetails = result.slot1Details || [];
    const startBtn = document.getElementById('startBtn');
    
    if (!startBtn) return;
    
    if (slotData.length === 0) {
      // No data, disable button
      startBtn.disabled = true;
      startBtn.style.background = '#6c757d';
      startBtn.style.cursor = 'not-allowed';
      return;
    }
    
    // Build live data map
    const liveDataMap = {};
    slotDetails.forEach(detail => {
      if (detail.success && detail.data.markets) {
        detail.data.markets.forEach(market => {
          if (market.selections) {
            market.selections.forEach(selection => {
              liveDataMap[selection.id] = selection.odds;
            });
          }
        });
      }
    });
    
    // Check if ALL selections have live odds
    let allHaveLiveOdds = true;
    for (const odd of slotData) {
      if (!liveDataMap[odd.marketId]) {
        allHaveLiveOdds = false;
        break;
      }
    }
    
    if (allHaveLiveOdds) {
      // Enable button
      startBtn.disabled = false;
      startBtn.style.background = '#28a745';
      startBtn.style.cursor = 'pointer';
      startBtn.textContent = '🚀 START';
      console.log('✅ All selections have live odds - START button enabled');
    } else {
      // Disable button
      startBtn.disabled = true;
      startBtn.style.background = '#6c757d';
      startBtn.style.cursor = 'not-allowed';
      startBtn.textContent = '🚀 START';
      console.log('⏳ Waiting for live odds...');
    }
  });
}

// Function to load and display slot data
function loadSlotData() {
  chrome.storage.local.get(['slot1Data', 'slot1Details'], (result) => {
    const container = document.querySelector('#mainSlot .slot-content');
    const data = result.slot1Data;
    const liveDetails = result.slot1Details || [];
    
    if (!data || data.length === 0) {
      container.innerHTML = '<p style="color: #999; text-align: center; padding: 20px;">No data stored</p>';
      setGolButtonMarketLocked(false);
      return;
    }
    
    // Build a map of marketId -> live data and track not found status
    const liveDataMap = {};
    const notFoundEvents = new Set();
    const eventsProcessed = new Set();
    
    liveDetails.forEach(result => {
      if (result.notFound) {
        // Event not found - mark all odds with this eventId
        notFoundEvents.add(result.eventId);
      } else if (result.success && result.data.markets) {
        eventsProcessed.add(result.eventId);
        result.data.markets.forEach(market => {
          if (market.selections) {
            market.selections.forEach(selection => {
              liveDataMap[selection.id] = {
                odds: selection.odds,
                status: selection.status,
                marketName: market.name
              };
            });
          }
        });
      }
    });
    
    // Display all odds in this slot with live data if available
    let hasUnavailableMarket = false;
    container.innerHTML = data.map(odd => {
      const liveData = odd.marketId ? liveDataMap[odd.marketId] : null;
      
      // Check if event not found OR market not found in event
      let isNotFound = notFoundEvents.has(odd.eventId);
      
      // If event was processed but market ID not found in liveDataMap
      if (!isNotFound && eventsProcessed.has(odd.eventId) && odd.marketId && !liveData) {
        isNotFound = true; // Market not found in event
      }

      const status = (liveData?.status || '').toLowerCase();
      const isMarketSuspended = !!liveData && status !== 'open';

      if (isNotFound || isMarketSuspended) {
        hasUnavailableMarket = true;
      }
      
      return createOddCard(odd, liveData, isNotFound, 1);
    }).join('');

    setGolButtonMarketLocked(hasUnavailableMarket);
    
    // After loading data, update button state
    updateGoalButtonState();
  });
}

// Load slot on startup
loadSlotData();

// Initialize button state on startup
setTimeout(updateGoalButtonState, 500);

// Helper function to fetch details for current slot with retry
let fetchRetryCount = 0;
const MAX_FETCH_RETRIES = 3;
let lastFetchTime = 0;

async function fetchDetailsForSlot() {
  const tabs = await chrome.tabs.query({ url: '*://*.sportpesa.com/*' });
  
  if (!tabs || tabs.length === 0) {
    return;
  }
  
  const tabId = tabs[0].id;
  
  chrome.storage.local.get(['slot1Data', 'slot1Details'], (result) => {
    const slotData = result.slot1Data;
    const slotDetails = result.slot1Details || [];
    
    if (slotData && slotData.length > 0) {
      const eventIds = slotData.map(odd => odd.eventId).filter(id => id);
      
      if (eventIds.length > 0) {
        // Check if details fetch failed (no valid details or all failed)
        const hasValidDetails = slotDetails.length > 0 && slotDetails.some(detail => detail.success && detail.data && detail.data.markets);
        const now = Date.now();
        
        // If last fetch was less than 2 seconds ago, skip (avoid spam)
        if (now - lastFetchTime < 2000) {
          return;
        }
        
        if (!hasValidDetails && fetchRetryCount > 0) {
          console.log(`🔄 Retrying fetch details... (Attempt ${fetchRetryCount + 1}/${MAX_FETCH_RETRIES})`);
        } else {
          console.log('🔄 Fetching details for slot...');
        }
        
        lastFetchTime = now;
        
        chrome.runtime.sendMessage({
          type: 'FETCH_EVENT_DETAILS',
          slotNumber: 1,
          eventIds: eventIds,
          tabId: tabId
        });
        
        // Check result after 1.5 seconds
        setTimeout(() => {
          chrome.storage.local.get(['slot1Details'], (checkResult) => {
            const details = checkResult.slot1Details || [];
            const hasValid = details.length > 0 && details.some(d => d.success && d.data && d.data.markets);
            
            if (!hasValid) {
              fetchRetryCount++;
              
              if (fetchRetryCount >= MAX_FETCH_RETRIES) {
                addBetStatusMessage('❌ Failed to update odds after 3 attempts', 'error');
                console.error('❌ Failed to fetch details after 3 attempts');
                fetchRetryCount = 0; // Reset for next time
              } else {
                // Retry after 3 seconds
                setTimeout(() => fetchDetailsForSlot(), 3000);
              }
            } else {
              // Success - reset counter
              if (fetchRetryCount > 0) {
                console.log('✅ Details fetched successfully after retry');
              }
              fetchRetryCount = 0;
            }
          });
        }, 1500);
      }
    }
  });
}

// Auto-refresh function (every 20 seconds)
async function autoRefreshSlot() {
  await fetchDetailsForSlot();
}

// Start auto-refresh every 20 seconds
setInterval(autoRefreshSlot, 20000);

// Run immediately on startup
setTimeout(autoRefreshSlot, 2000);

// Function to load and display cookies
function loadCookies() {
  chrome.storage.local.get(['capturedCookies', 'cookiesTimestamp'], (result) => {
    const cookiesDiv = document.getElementById('cookiesDisplay');
    
    if (!result.capturedCookies) {
      cookiesDiv.innerHTML = '<p style="color: #999;">Waiting for /api/users/profile request...</p>';
      return;
    }
    
    const cookies = result.capturedCookies;
    const timestamp = new Date(result.cookiesTimestamp).toLocaleString();
    
    let html = `<p><strong>Captured at:</strong> ${timestamp}</p>`;
    html += '<div style="max-height: 150px; overflow-y: auto; margin-top: 10px;">';
    
    Object.keys(cookies).forEach(name => {
      html += `<div style="margin: 5px 0; padding: 5px; background: white; border-radius: 4px;">`;
      html += `<strong>${name}:</strong> <code style="font-size: 11px; word-break: break-all;">${cookies[name]}</code>`;
      html += `</div>`;
    });
    
    html += '</div>';
    cookiesDiv.innerHTML = html;
  });
}

// Load cookies on startup
loadCookies();

// Manual cookie capture button
document.getElementById('captureCookiesBtn').addEventListener('click', async () => {
  // Get active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!tab || !tab.url.includes('sportpesa.com')) {
    console.log('⚠️ No SportPesa tab open');
    return;
  }
  
  // Send message to background to capture cookies manually
  chrome.runtime.sendMessage({ type: 'MANUAL_COOKIE_CAPTURE', tabId: tab.id }, (response) => {
    if (response && response.success) {
      loadCookies();
    }
  });
});

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local' && changes.allOdds) {
    const newData = changes.allOdds.newValue || [];
    
    // Update slot if in 'recording' state
    if (slotState === 'recording') {
      chrome.storage.local.set({ slot1Data: newData }, () => {
        loadSlotData();
        // Immediately fetch details for new selections
        fetchDetailsForSlot();
      });
    }
  }
  
  // Reload slot if its data changed
  if (changes.slot1Data) {
    loadSlotData();
    // Fetch details when slot data changes
    fetchDetailsForSlot();
  }
  
  // Reload cookies if captured
  if (changes.capturedCookies) {
    loadCookies();
  }
  
  // Handle cashout response
  if (changes.lastCashoutResponse) {
    const response = changes.lastCashoutResponse.newValue;
    console.log('💰 Cashout response received in sidepanel:', response);
    
    if (response.success) {
      addBetStatusMessage(`✅ Cashed out bet ${response.betId} successfully!`, 'success');
    } else {
      addBetStatusMessage(`❌ Cashout failed for bet ${response.betId}: ${response.error}`, 'error');
    }
  }
  
  // Display event details if fetched
  if (changes.slot1Details) {
    displayEventDetails(changes.slot1Details.newValue);
    // Update button state when new details arrive
    updateGoalButtonState();
  }
  
  // Handle bet response
  if (changes.lastBetResponse) {
    const response = changes.lastBetResponse.newValue;
    
    console.log('📬 Bet response received:', response);
    
    // Parse response content (not response.success flag)
    let hasError = false;
    let errorMessage = 'BET FAILED';
    
    // Check if response data contains error array
    if (response.data) {
      try {
        const data = typeof response.data === 'string' ? JSON.parse(response.data) : response.data;
        
        if (Array.isArray(data) && data.length > 0) {
          const firstItem = data[0];
          
          // Check if it's an error object
          if (firstItem.type === 'error' || firstItem.code) {
            hasError = true;
            
            // Check for insufficient funds
            if (firstItem.code === 120 || (firstItem.msg && firstItem.msg.toLowerCase().includes('insufficient funds'))) {
              errorMessage = 'INSUFFICIENT FUNDS';
              // Cycle is driven by the interval timer; do not reset it here.
            } else {
              errorMessage = `ERROR: ${firstItem.msg || firstItem.code || 'Unknown'}`;
            }
          }
        }
      } catch (e) {
        console.log('⚠️ Failed to parse response data:', e);
      }
    }
    
    // Also check response.error field
    if (!hasError && response.error) {
      hasError = true;
      try {
        const errors = typeof response.error === 'string' ? JSON.parse(response.error) : response.error;
        
        if (Array.isArray(errors) && errors.length > 0) {
          const firstError = errors[0];
          
          if (firstError.code === 120 || (firstError.msg && firstError.msg.toLowerCase().includes('insufficient funds'))) {
            errorMessage = 'INSUFFICIENT FUNDS';
            // Cycle is driven by the interval timer; do not reset it here.
          } else {
            errorMessage = `ERROR: ${firstError.msg || firstError.code || 'Unknown'}`;
          }
        } else if (typeof response.error === 'string') {
          errorMessage = `ERROR: ${response.error}`;
          
          // Check for "Unexpected token" error (502 Bad Gateway) - bet was not sent
          if (response.error.includes('Unexpected token')) {
            console.log('⚠️ 502 Bad Gateway - bet not sent, retrying in 3 seconds...');
            if (isAutoSending) {
              scheduleNextBet(3000);
            }
          }
        }
      } catch (e) {
        errorMessage = `ERROR: ${response.error}`;
        
        // Check for "Unexpected token" in catch block too
        if (typeof response.error === 'string' && response.error.includes('Unexpected token')) {
          console.log('⚠️ 502 Bad Gateway - bet not sent, retrying in 3 seconds...');
          if (isAutoSending) {
            scheduleNextBet(3000);
          }
        }
      }
    }
    
    const rawErrorText = [
      typeof response.error === 'string' ? response.error : '',
      typeof response.data === 'string' ? response.data : '',
      typeof errorMessage === 'string' ? errorMessage : ''
    ].join(' ').toLowerCase();
    const isSuspendedMarketError = hasError && rawErrorText.includes('market status is suspended');

    if (isSuspendedMarketError) {
      setGolButtonSuspendedErrorLocked(true);
    } else {
      // Clear suspended lock as soon as response is no longer "market suspended".
      setGolButtonSuspendedErrorLocked(false);
    }
    // Force an immediate market status refresh so GOL lock follows real-time state.
    fetchDetailsForSlot();

    // Display message
    if (hasError) {
      addBetStatusMessage(errorMessage, 'error');
    } else {
      addBetStatusMessage('BET PLACED SUCCESSFULLY', 'success');
      // Timer does NOT reset on successful bet - it was already stopped by GOL button
    }
    
    // Next bet is driven by the interval timer (scheduleNextBet), not by the response.
  }
});

// Function to display event details - now just reloads the slot with live data
function displayEventDetails(results) {
  // Simply reload slot data which will now include live odds in the cards
  loadSlotData();
}

// Bet popup close button
document.addEventListener('DOMContentLoaded', () => {
  const overlay = document.getElementById('betPopupOverlay');
  const closeBtn = document.getElementById('betPopupClose');
  
  if (overlay && closeBtn) {
    closeBtn.addEventListener('click', () => {
      overlay.style.display = 'none';
    });
    
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.style.display = 'none';
      }
    });
  }
});

// ============================================
// PROVERI Button - Check Bet History
// ============================================
document.getElementById('proveriBtn').addEventListener('click', async () => {
  console.log('🔍 PROVERI button clicked - checking bet history');
  
  try {
    // Find SportPesa tab
    const tabs = await chrome.tabs.query({ url: '*://www.ke.sportpesa.com/*' });
    if (!tabs || tabs.length === 0) {
      console.log('❌ No SportPesa tab found');
      addBetStatusMessage('No SportPesa tab found', 'error');
      return;
    }
    
    const tabId = tabs[0].id;
    
    // Execute XHR in SportPesa tab context
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: 'MAIN',
      func: () => {
        return new Promise((resolve, reject) => {
          try {
            // Generate dynamic timestamps for last 7 days (Kenya timezone)
            const now = new Date();
            const kenyaOffset = 3 * 60 * 60 * 1000; // Kenya is UTC+3
            const kenyaNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60 * 1000) + kenyaOffset);
            
            // End of today (23:59:59) in Kenya
            const dateTo = new Date(kenyaNow);
            dateTo.setHours(23, 59, 59, 999);
            
            // Start of 7 days ago (00:00:00) in Kenya
            const dateFrom = new Date(dateTo);
            dateFrom.setDate(dateFrom.getDate() - 6);
            dateFrom.setHours(0, 0, 0, 0);
            
            // Convert to Unix timestamps (seconds)
            const dateFromTimestamp = Math.floor(dateFrom.getTime() / 1000).toString();
            const dateToTimestamp = Math.floor(dateTo.getTime() / 1000).toString();
            
            const xhr = new XMLHttpRequest();
            xhr.open("POST", "https://www.ke.sportpesa.com/api/bets/history", true);
            
            // Set headers
            xhr.setRequestHeader("accept", "application/json, text/plain, */*");
            xhr.setRequestHeader("accept-language", "en-US,en;q=0.9");
            xhr.setRequestHeader("content-type", "application/json;charset=UTF-8");
            xhr.setRequestHeader("sec-ch-ua", "\"Chromium\";v=\"142\", \"Google Chrome\";v=\"142\", \"Not_A Brand\";v=\"99\"");
            xhr.setRequestHeader("sec-ch-ua-mobile", "?0");
            xhr.setRequestHeader("sec-ch-ua-platform", "\"Windows\"");
            xhr.setRequestHeader("sec-fetch-dest", "empty");
            xhr.setRequestHeader("sec-fetch-mode", "cors");
            xhr.setRequestHeader("sec-fetch-site", "same-origin");
            xhr.setRequestHeader("x-app-timezone", "Africa/Nairobi");
            xhr.setRequestHeader("x-requested-with", "XMLHttpRequest");
            
            xhr.onload = function() {
              if (xhr.status >= 200 && xhr.status < 300) {
                try {
                  const data = JSON.parse(xhr.responseText);
                  resolve({ success: true, data: data });
                } catch (e) {
                  resolve({ success: false, error: 'Failed to parse response' });
                }
              } else {
                resolve({ success: false, error: `HTTP ${xhr.status}` });
              }
            };
            
            xhr.onerror = function() {
              resolve({ success: false, error: 'Network error' });
            };
            
            // Send request with dynamic dates
            xhr.send(JSON.stringify({
              dateFrom: dateFromTimestamp,
              dateTo: dateToTimestamp,
              section: ["prematch"],
              status: [],
              count: 10,
              offset: 0
            }));
          } catch (error) {
            resolve({ success: false, error: error.message });
          }
        });
      }
    });
    
    if (results && results[0] && results[0].result) {
      const result = results[0].result;
      
      if (result.success) {
        console.log('✅ Bet history response:', result.data);
        
        // Filter active bets
        const activeBets = result.data.bets.filter(bet => bet.status === 'active');
        
        if (activeBets.length > 0) {
          addBetStatusMessage(`Found ${activeBets.length} active bet(s)`, 'success');
          
          activeBets.forEach(bet => {
            addBetStatusMessage(`ID: ${bet.id} | Stake: ${bet.amount} KES`, 'info');
            console.log('🎯 Active bet:', { id: bet.id, amount: bet.amount, description: bet.description });
          });
          
          // Check cashout options for ALL active bets (one by one)
          addBetStatusMessage(`Checking cashout for all ${activeBets.length} bet(s)...`, 'info');
          
          const validCashouts = [];
          
          // Process each bet sequentially with retry
          for (const bet of activeBets) {
            let success = false;
            let retries = 0;
            const maxRetries = 3;
            
            while (!success && retries < maxRetries) {
              if (retries > 0) {
                console.log(`🔄 Retry ${retries}/${maxRetries} for bet ${bet.id}...`);
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s before retry
              } else {
                console.log(`🔄 Checking cashout for bet ${bet.id}...`);
              }
              
              try {
                const result = await chrome.scripting.executeScript({
                  target: { tabId: tabId },
                  world: 'MAIN',
                  args: [bet.id],
                  func: (betId) => {
                    return new Promise((resolve) => {
                      const xhr = new XMLHttpRequest();
                      xhr.open("POST", "https://www.ke.sportpesa.com/api/bets/cashout/options", true);
                      xhr.setRequestHeader("accept", "application/json, text/plain, */*");
                      xhr.setRequestHeader("content-type", "application/json;charset=UTF-8");
                      xhr.setRequestHeader("x-requested-with", "XMLHttpRequest");
                      
                      xhr.onload = function() {
                        if (xhr.status >= 200 && xhr.status < 300) {
                          const data = JSON.parse(xhr.responseText);
                          resolve({ success: true, data: data, betId: betId });
                        } else {
                          resolve({ success: false, error: `HTTP ${xhr.status}`, betId: betId });
                        }
                      };
                      
                      xhr.onerror = () => resolve({ success: false, error: 'Network error', betId: betId });
                      xhr.send(JSON.stringify({ betId: betId }));
                    });
                  }
                });
                
                if (result && result[0] && result[0].result) {
                  const res = result[0].result;
                  
                  console.log(`🔍 Bet ${res.betId} - API response:`, JSON.stringify(res.data));
                  
                  if (res.success && res.data) {
                    const optionsData = res.data;
                    
                    // Check if cashout is available
                    if (optionsData.cashoutOperation && optionsData.cashoutOperation.length > 0) {
                      const cashoutDetails = optionsData.cashoutOperation[0];
                      const cashoutAmount = parseFloat(cashoutDetails.totalValueOperation);
                      
                      validCashouts.push({
                        betId: res.betId,
                        amount: cashoutAmount,
                        details: cashoutDetails
                      });
                      
                      console.log(`💰 Bet ${res.betId} cashout: ${cashoutAmount} KES`);
                      success = true; // Mark as successful
                    } else {
                      console.log(`❌ Bet ${res.betId} - no cashoutOperation in response`);
                      addBetStatusMessage(`Bet ${res.betId}: No cashout available`, 'warning');
                      success = true; // Don't retry if cashout not available
                    }
                  } else {
                    console.log(`❌ Bet ${res.betId} - API request failed`);
                    retries++;
                  }
                } else {
                  console.log(`❌ Bet ${bet.id} - result is undefined, will retry...`);
                  retries++;
                }
              } catch (error) {
                console.error(`❌ Error checking bet ${bet.id}:`, error);
                retries++;
              }
            }
            
            if (!success) {
              console.log(`❌ Failed to get cashout for bet ${bet.id} after ${maxRetries} attempts`);
              addBetStatusMessage(`Bet ${bet.id}: Failed after ${maxRetries} attempts`, 'error');
            }
          }
          
          if (validCashouts.length > 0) {
            // Sort by amount to show all cashouts
            validCashouts.sort((a, b) => a.amount - b.amount);
            
            // Display all cashout amounts
            addBetStatusMessage(`📊 Cashout amounts:`, 'info');
            validCashouts.forEach(c => {
              addBetStatusMessage(`  Bet ${c.betId}: ${c.amount} KES`, 'info');
            });
            
            // Find the bet with MINIMUM cashout amount (first after sorting)
            const minCashout = validCashouts[0];
            
            addBetStatusMessage(`✅ Selected MINIMUM: Bet ${minCashout.betId} = ${minCashout.amount} KES`, 'success');
            console.log('🎯 Selected minimum cashout:', minCashout);
            
            // Save the MINIMUM cashout data for GOL button
            chrome.storage.local.set({
              savedCashoutData: {
                betId: minCashout.betId,
                cashoutType: minCashout.details.cashoutType,
                valueOperation: minCashout.details.valueOperation,
                valueOperationTax: minCashout.details.valueOperationTax,
                totalValueOperation: minCashout.details.totalValueOperation,
                family: minCashout.details.family
              }
            });
          } else {
            addBetStatusMessage(`❌ No cashout available for any bet`, 'warning');
            chrome.storage.local.remove(['savedCashoutData']);
          }
        } else {
          addBetStatusMessage('No active bets found', 'warning');
        }
      } else {
        console.log('❌ Bet history error:', result.error);
        addBetStatusMessage('Failed to load bet history', 'error');
      }
    }
  } catch (error) {
    console.error('❌ PROVERI error:', error);
    addBetStatusMessage('Error checking bet history', 'error');
  }
});

// Timer variables
let autoCheckIntervalMs = 17000; // Default 17 seconds
let timerIntervalId = null;
let timerStartTime = null;
let timerEndTime = null;

function nowMs() {
  return performance.now();
}

// Update timer display
function updateTimerDisplay() {
  const timerBar = document.getElementById('timerBar');
  const timerCounter = document.getElementById('timerCounter');

  if (!timerStartTime || !timerEndTime) return;

  const total = Math.max(1, timerEndTime - timerStartTime);
  const remaining = Math.max(0, timerEndTime - nowMs());
  const progress = ((total - remaining) / total) * 100;

  timerBar.style.width = `${progress}%`;
  timerCounter.textContent = `${(remaining / 1000).toFixed(2)}s`;
  setGolButtonLocked(isAutoSending && remaining > 10000);

  if (remaining <= 0 && timerIntervalId) {
    clearInterval(timerIntervalId);
    timerIntervalId = null;
  }
}

// Start timer display
function startTimerDisplay(durationMs = autoCheckIntervalMs) {
  timerStartTime = nowMs();
  timerEndTime = timerStartTime + durationMs;
  if (timerIntervalId) clearInterval(timerIntervalId);
  updateTimerDisplay();
  timerIntervalId = setInterval(updateTimerDisplay, 50);
}

function stopTimerDisplay() {
  if (timerIntervalId) {
    clearInterval(timerIntervalId);
    timerIntervalId = null;
  }
  timerStartTime = null;
  timerEndTime = null;
}

function resetTimerDisplay() {
  stopTimerDisplay();
  const timerBar = document.getElementById('timerBar');
  const timerCounter = document.getElementById('timerCounter');
  if (timerBar) timerBar.style.width = '0%';
  if (timerCounter) timerCounter.textContent = '0.00s';
  setGolButtonLocked(false);
}

// Timer-driven cycle: fires a bet every interval WITHOUT waiting for the response.
function scheduleNextBet(delayMs = autoCheckIntervalMs) {
  if (cycleTimeoutId) {
    clearTimeout(cycleTimeoutId);
    cycleTimeoutId = null;
  }

  if (!isAutoSending) return;

  const targetTime = nowMs() + delayMs;
  startTimerDisplay(delayMs);

  const tick = () => {
    if (!isAutoSending) return;

    const remaining = targetTime - nowMs();
    if (remaining <= 0) {
      cycleTimeoutId = null;
      updateTimerDisplay();
      Promise.resolve(sendBet()).finally(() => {
        if (isAutoSending) {
          scheduleNextBet(autoCheckIntervalMs);
        }
      });
      return;
    }

    cycleTimeoutId = setTimeout(tick, Math.min(remaining, 100));
  };

  cycleTimeoutId = setTimeout(tick, Math.min(delayMs, 100));
}

// Save interval button
document.getElementById('saveIntervalButton').addEventListener('click', () => {
  const input = document.getElementById('autoCheckInterval');
  const newInterval = parseInt(input.value);
  
  if (newInterval < 1000) {
    alert('Interval must be at least 1000ms (1 second)');
    return;
  }
  
  autoCheckIntervalMs = newInterval;
  
  // Only restart the cycle if auto-sending is active
  if (isAutoSending) {
    scheduleNextBet(autoCheckIntervalMs);
  }
  
  addBetStatusMessage(`✅ Interval updated to ${autoCheckIntervalMs}ms`, 'success');
  console.log(`✅ Cycle interval set to ${autoCheckIntervalMs}ms`);
});

// Auto-check cashout every 60 seconds
async function autoCheckCashout() {
  try {
    // Find SportPesa tab
    const tabs = await chrome.tabs.query({ url: '*://www.ke.sportpesa.com/*' });
    if (!tabs || tabs.length === 0) {
      console.log('⏰ Auto-check: No SportPesa tab found');
      return;
    }
    
    const tabId = tabs[0].id;
    console.log('⏰ Auto-checking for cashout...');
    
    // Fetch bet history
    const results = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: 'MAIN',
      func: () => {
        return new Promise((resolve) => {
          // Generate dynamic timestamps for last 7 days (Kenya timezone)
          const now = new Date();
          const kenyaOffset = 3 * 60 * 60 * 1000; // Kenya is UTC+3
          const kenyaNow = new Date(now.getTime() + (now.getTimezoneOffset() * 60 * 1000) + kenyaOffset);
          
          // End of today (23:59:59) in Kenya
          const dateTo = new Date(kenyaNow);
          dateTo.setHours(23, 59, 59, 999);
          
          // Start of 7 days ago (00:00:00) in Kenya
          const dateFrom = new Date(dateTo);
          dateFrom.setDate(dateFrom.getDate() - 6);
          dateFrom.setHours(0, 0, 0, 0);
          
          // Convert to Unix timestamps (seconds)
          const dateFromTimestamp = Math.floor(dateFrom.getTime() / 1000).toString();
          const dateToTimestamp = Math.floor(dateTo.getTime() / 1000).toString();
          
          const xhr = new XMLHttpRequest();
          xhr.open("POST", "https://www.ke.sportpesa.com/api/bets/history", true);
          xhr.setRequestHeader("accept", "application/json, text/plain, */*");
          xhr.setRequestHeader("content-type", "application/json;charset=UTF-8");
          xhr.setRequestHeader("x-requested-with", "XMLHttpRequest");
          
          xhr.onload = function() {
            if (xhr.status >= 200 && xhr.status < 300) {
              const data = JSON.parse(xhr.responseText);
              resolve({ success: true, data: data });
            } else {
              resolve({ success: false, error: `HTTP ${xhr.status}` });
            }
          };
          
          xhr.onerror = () => resolve({ success: false, error: 'Network error' });
          xhr.send(JSON.stringify({
            dateFrom: dateFromTimestamp,
            dateTo: dateToTimestamp,
            section: ["prematch"],
            status: [],
            count: 10,
            offset: 0
          }));
        });
      }
    });
    
    if (results && results[0] && results[0].result && results[0].result.success) {
      const result = results[0].result;
      const activeBets = result.data.bets.filter(bet => bet.status === 'active');
      
      if (activeBets.length > 0) {
        console.log(`⏰ Auto-check: Found ${activeBets.length} active bet(s)`);
        addBetStatusMessage(`⏰ Auto-check: Found ${activeBets.length} active bet(s)`, 'success');
        
        // Check cashout options for ALL active bets (one by one) with retry
        const validCashouts = [];
        
        for (const bet of activeBets) {
          let success = false;
          let retries = 0;
          const maxRetries = 3;
          
          while (!success && retries < maxRetries) {
            if (retries > 0) {
              console.log(`⏰ Retry ${retries}/${maxRetries} for bet ${bet.id}...`);
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
            try {
              const result = await chrome.scripting.executeScript({
                target: { tabId: tabId },
                world: 'MAIN',
                args: [bet.id],
                func: (betId) => {
                  return new Promise((resolve) => {
                    const xhr = new XMLHttpRequest();
                    xhr.open("POST", "https://www.ke.sportpesa.com/api/bets/cashout/options", true);
                    xhr.setRequestHeader("accept", "application/json, text/plain, */*");
                    xhr.setRequestHeader("content-type", "application/json;charset=UTF-8");
                    xhr.setRequestHeader("x-requested-with", "XMLHttpRequest");
                    
                    xhr.onload = function() {
                      if (xhr.status >= 200 && xhr.status < 300) {
                        const data = JSON.parse(xhr.responseText);
                        resolve({ success: true, data: data, betId: betId });
                      } else {
                        resolve({ success: false, error: `HTTP ${xhr.status}`, betId: betId });
                      }
                    };
                    
                    xhr.onerror = () => resolve({ success: false, error: 'Network error', betId: betId });
                    xhr.send(JSON.stringify({ betId: betId }));
                  });
                }
              });
              
              if (result && result[0] && result[0].result) {
                const res = result[0].result;
                
                if (res.success && res.data) {
                  const optionsData = res.data;
                  
                  if (optionsData.cashoutOperation && optionsData.cashoutOperation.length > 0) {
                    const cashoutDetails = optionsData.cashoutOperation[0];
                    const cashoutAmount = parseFloat(cashoutDetails.totalValueOperation);
                    
                    validCashouts.push({
                      betId: res.betId,
                      amount: cashoutAmount,
                      details: cashoutDetails
                    });
                    
                    console.log(`⏰ Bet ${res.betId} cashout: ${cashoutAmount} KES`);
                    success = true;
                  } else {
                    console.log(`⏰ Bet ${res.betId} - no cashout available`);
                    success = true; // Don't retry
                  }
                } else {
                  console.log(`⏰ Bet ${res.betId} - API request failed`);
                  retries++;
                }
              } else {
                console.log(`⏰ Bet ${bet.id} - result is undefined, will retry...`);
                retries++;
              }
            } catch (error) {
              console.error(`⏰ Error checking bet ${bet.id}:`, error);
              retries++;
            }
          }
          
          if (!success) {
            console.log(`⏰ Failed to get cashout for bet ${bet.id} after ${maxRetries} attempts`);
          }
        }
        
        if (validCashouts.length > 0) {
          // Find the bet with MINIMUM cashout amount
          const minCashout = validCashouts.reduce((min, current) => 
            current.amount < min.amount ? current : min
          );
          
          addBetStatusMessage(`⏰ Selected MINIMUM: Bet ${minCashout.betId} = ${minCashout.amount} KES`, 'success');
          console.log('⏰ Selected minimum cashout:', minCashout);
          
          // Save the MINIMUM cashout data for GOL button
          chrome.storage.local.set({
            savedCashoutData: {
              betId: minCashout.betId,
              cashoutType: minCashout.details.cashoutType,
              valueOperation: minCashout.details.valueOperation,
              valueOperationTax: minCashout.details.valueOperationTax,
              totalValueOperation: minCashout.details.totalValueOperation,
              family: minCashout.details.family
            }
          });
        } else {
          addBetStatusMessage(`⏰ No cashout available`, 'warning');
          chrome.storage.local.remove(['savedCashoutData']);
        }
      } else {
        console.log('⏰ Auto-check: No active bets');
        addBetStatusMessage('⏰ Auto-check: No active bets', 'warning');
      }
    } else {
      addBetStatusMessage('⏰ Auto-check: Failed to fetch bets', 'error');
    }
  } catch (error) {
    console.error('❌ Auto-check error:', error);
  }
}

// Start auto-check every 5 minutes (300 seconds)
setInterval(autoCheckCashout, 300000);

// Run once on startup after 2 seconds
setTimeout(autoCheckCashout, 2000);

// ============================================
// PREMATCH - replay a manually captured prematch ticket (API-only, isolated from live)
// ============================================
let prematchStakeAmount = 100;

function getNormalizedPrematchStake(value) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const prematchStakeInputEl = document.getElementById('prematchStakeInput');
const prematchMatchNameEl = document.getElementById('prematchMatchName');
const savePrematchButtonEl = document.getElementById('savePrematchButton');
const prematchButtonEl = document.getElementById('prematchBtn');

function setPrematchMatchNameDisplay(name) {
  if (!prematchMatchNameEl) return;
  const clean = typeof name === 'string' ? name.trim() : '';
  const compact = clean.length > 80 ? clean.slice(0, 77) + '...' : clean;
  prematchMatchNameEl.textContent = compact ? ('Mec: ' + compact) : 'Mec: -';
}

chrome.storage.local.get(['prematchStakeAmount', 'prematchSavedName'], (result) => {
  const storedStake = getNormalizedPrematchStake(result.prematchStakeAmount);
  prematchStakeAmount = storedStake || 100;
  if (prematchStakeInputEl) prematchStakeInputEl.value = String(prematchStakeAmount);
  if (result.prematchSavedName) setPrematchMatchNameDisplay(result.prematchSavedName);
});

function persistPrematchStakeValue() {
  const parsed = getNormalizedPrematchStake(prematchStakeInputEl ? prematchStakeInputEl.value : null);
  if (!parsed) {
    if (prematchStakeInputEl) prematchStakeInputEl.value = String(prematchStakeAmount);
    return false;
  }
  prematchStakeAmount = parsed;
  chrome.storage.local.set({ prematchStakeAmount: prematchStakeAmount });
  return true;
}

if (prematchStakeInputEl) {
  prematchStakeInputEl.addEventListener('input', () => { persistPrematchStakeValue(); });
  prematchStakeInputEl.addEventListener('change', () => { persistPrematchStakeValue(); });
}

function normalizePrematchBets(bets) {
  if (!Array.isArray(bets)) return [];
  const out = [];
  const seen = new Set();
  bets.forEach((b) => {
    if (!b || typeof b !== 'object') return;
    const id = Number(b.id);
    if (!Number.isFinite(id)) return;
    const odds = (b.odds !== undefined && b.odds !== null) ? String(b.odds) : '';
    const coeff = (b.coeff !== undefined && b.coeff !== null) ? String(b.coeff) : odds;
    if (!odds) return;
    const key = id + ':' + odds + ':' + coeff;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id: id, odds: odds, coeff: coeff });
  });
  return out;
}

async function getPrematchTargetTab() {
  const active = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeTab = active && active[0] ? active[0] : null;
  if (activeTab && activeTab.id && activeTab.url && activeTab.url.includes('sportpesa.com')) {
    return activeTab;
  }
  const tabs = await chrome.tabs.query({ url: '*://www.ke.sportpesa.com/*' });
  return tabs && tabs.length > 0 ? tabs[0] : null;
}

async function lookupPrematchMatchName(tabId, betIds) {
  try {
    const wrapped = await chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: 'MAIN',
      args: [betIds],
      func: async (idList) => {
        try {
          const now = new Date();
          const off = 3 * 60 * 60 * 1000;
          const eaNow = new Date(now.getTime() + now.getTimezoneOffset() * 60000 + off);
          const dTo = new Date(eaNow); dTo.setHours(23, 59, 59, 999);
          const dFrom = new Date(dTo); dFrom.setDate(dFrom.getDate() - 6); dFrom.setHours(0, 0, 0, 0);
          const res = await fetch('https://www.ke.sportpesa.com/api/bets/history', {
            method: 'POST',
            headers: {
              'accept': 'application/json, text/plain, */*',
              'content-type': 'application/json;charset=UTF-8',
              'x-app-timezone': 'Africa/Nairobi',
              'x-requested-with': 'XMLHttpRequest'
            },
            body: JSON.stringify({
              dateFrom: Math.floor(dFrom.getTime() / 1000).toString(),
              dateTo: Math.floor(dTo.getTime() / 1000).toString(),
              section: ['prematch'], status: [], count: 20, offset: 0
            }),
            mode: 'cors', credentials: 'include'
          });
          if (!res.ok) return '';
          const data = await res.json().catch(() => null);
          const tickets = data && Array.isArray(data.bets) ? data.bets : [];
          const nameOf = (t) => (t && (t.description || t.eventName || t.name)) ? String(t.description || t.eventName || t.name).trim() : '';
          const ids = (idList || []).map((x) => String(x));
          for (const t of tickets) {
            const asText = JSON.stringify(t);
            let matched = false;
            for (const id of ids) { if (asText.indexOf(id) !== -1) { matched = true; break; } }
            if (matched) { const nm = nameOf(t); if (nm) return nm; }
          }
          return tickets.length > 0 ? nameOf(tickets[0]) : '';
        } catch (e) {
          return '';
        }
      }
    });
    return wrapped && wrapped[0] && typeof wrapped[0].result === 'string' ? wrapped[0].result : '';
  } catch (e) {
    return '';
  }
}

if (savePrematchButtonEl) {
  savePrematchButtonEl.addEventListener('click', async () => {
    persistPrematchStakeValue();
    const stored = await new Promise((resolve) => chrome.storage.local.get(['prematchLastCaptured'], resolve));
    const captured = stored.prematchLastCaptured;
    const bets = captured ? normalizePrematchBets(captured.bets) : [];
    if (bets.length === 0) {
      addBetStatusMessage('Prvo odigraj prematch tiket rucno jednom, pa Save', 'warning');
      return;
    }
    chrome.storage.local.set({ prematchSavedBets: bets });
    addBetStatusMessage('Prematch tiket sacuvan (stake ' + prematchStakeAmount + ')', 'success');
    const tab = await getPrematchTargetTab();
    if (tab && tab.id) {
      const name = await lookupPrematchMatchName(tab.id, bets.map((b) => b.id));
      if (name) {
        chrome.storage.local.set({ prematchSavedName: name });
        setPrematchMatchNameDisplay(name);
      }
    }
  });
}

if (prematchButtonEl) {
  prematchButtonEl.addEventListener('click', async () => {
    prematchButtonEl.disabled = true;
    prematchButtonEl.style.opacity = '0.85';
    try {
      persistPrematchStakeValue();
      const stored = await new Promise((resolve) => chrome.storage.local.get(['prematchSavedBets'], resolve));
      const bets = normalizePrematchBets(stored.prematchSavedBets);
      if (bets.length === 0) {
        addBetStatusMessage('ne odigran prematch', 'error');
        return;
      }
      const tab = await getPrematchTargetTab();
      if (!tab || !tab.id) {
        addBetStatusMessage('ne odigran prematch', 'error');
        return;
      }
      const stake = getNormalizedPrematchStake(prematchStakeAmount) || 100;
      const wrapped = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        args: [stake, bets],
        func: async (stakeValue, betsPayload) => {
          const hasApiError = (payload) => {
            if (!payload) return false;
            if (Array.isArray(payload)) return payload.some(hasApiError);
            if (typeof payload === 'object') {
              const type = String(payload.type || '').toLowerCase();
              if (type === 'error') return true;
              if (payload.code && Number(payload.code) !== 0) return true;
            }
            return false;
          };
          try {
            const res = await fetch('https://www.ke.sportpesa.com/api/bets/place', {
              method: 'POST',
              headers: {
                'accept': 'application/json, text/plain, */*',
                'accept-language': 'en-US,en;q=0.9,sr;q=0.8',
                'cache-control': 'no-cache',
                'pragma': 'no-cache',
                'content-type': 'application/json;charset=UTF-8',
                'x-app-timezone': 'Africa/Nairobi',
                'x-requested-with': 'XMLHttpRequest'
              },
              body: JSON.stringify({ amount: stakeValue, bets: betsPayload, acceptOdds: true, betSpinner: true }),
              mode: 'cors', credentials: 'include'
            });
            const data = await res.json().catch(() => null);
            return { success: res.status === 200 && !hasApiError(data) };
          } catch (e) {
            return { success: false };
          }
        }
      });
      const result = wrapped && wrapped[0] ? wrapped[0].result : null;
      if (result && result.success) {
        addBetStatusMessage('odigran prematch', 'success');
      } else {
        addBetStatusMessage('ne odigran prematch', 'error');
      }
    } catch (e) {
      addBetStatusMessage('ne odigran prematch', 'error');
    } finally {
      prematchButtonEl.disabled = false;
      prematchButtonEl.style.opacity = '1';
    }
  });
}
