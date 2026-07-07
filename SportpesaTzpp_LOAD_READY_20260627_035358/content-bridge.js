// Bridge content script (ISOLATED world)
// Receives CustomEvent from the page (MAIN world) and forwards it to background

// Listen for DOM selections from MAIN world
document.addEventListener('sportpesa_dom_selection', (event) => {
  const selectionData = event?.detail;
  if (!selectionData) return;

  // Forward to background
  try {
    chrome.runtime.sendMessage({
      type: 'DOM_SELECTION_FOUND',
      data: selectionData
    });
  } catch (e) {
    // Silent fail
  }
});

// Listen for cookies captured from MAIN world
document.addEventListener('sportpesa_cookies_captured', (event) => {
  const cookieData = event?.detail;
  if (!cookieData) return;

  // Forward to background
  try {
    chrome.runtime.sendMessage({
      type: 'COOKIES_CAPTURED',
      data: cookieData
    });
  } catch (e) {
    // Silent fail
  }
});

// Listen for event details response from MAIN world
document.addEventListener('sportpesa_event_details', (event) => {
  // Forward to background script
  chrome.runtime.sendMessage({
    type: 'EVENT_DETAILS_RESPONSE',
    data: event.detail
  }, () => {
    // silent
  });
});

// Listen for bet placed response from MAIN world
document.addEventListener('sportpesa_bet_placed', (event) => {
  console.log('🔔 Bet placed response received in content bridge:', event.detail);
  
  // Forward to background script
  chrome.runtime.sendMessage({
    type: 'BET_PLACED_RESPONSE',
    data: event.detail
  }, () => {
    console.log(' Bet placed response forwarded to background');
  });
});

// Listen for passive prematch placement capture from MAIN world
document.addEventListener('sportpesa_prematch_captured', (event) => {
  try {
    chrome.runtime.sendMessage({
      type: 'PREMATCH_CAPTURED',
      data: event.detail
    });
  } catch (e) {
    // Silent fail
  }
});

// Listen for wallet balance status from MAIN world
document.addEventListener('sportpesa_wallet_balance', (event) => {
  try {
    chrome.runtime.sendMessage({
      type: 'WALLET_BALANCE',
      data: event.detail
    }, () => {
      // silent
    });
  } catch (e) {
    console.log(' Failed to forward wallet balance status:', e);
  }
});

// Listen for Mines auth data via window.postMessage from MAIN world
window.addEventListener('message', (event) => {
  if (event.data.type === 'MINES_AUTH_CAPTURED') {
    console.log(' Mines auth data captured:', event.data.data);
    
    try {
      chrome.runtime.sendMessage({
        type: 'MINES_AUTH_CAPTURED',
        data: event.data.data
      }, () => {
        console.log(' Mines auth data forwarded to background');
      });
    } catch (e) {
      console.log(' Failed to forward Mines auth data:', e);
    }
  }
  
  // Listen for cashout response from MAIN world
  if (event.data.type === 'CASHOUT_RESPONSE') {
    console.log(' Cashout response:', event.data);
    
    try {
      chrome.runtime.sendMessage({
        type: 'CASHOUT_RESPONSE',
        data: event.data.data
      });
    } catch (e) {
      console.log(' Failed to forward cashout response:', e);
    }
  }
});

// Listen for cashout command from background/sidepanel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SEND_CASHOUT') {
    console.log(' Forwarding cashout command to page:', message.data);
    // Forward to MAIN world
    window.postMessage({
      type: 'SEND_CASHOUT',
      data: message.data
    }, '*');
    sendResponse({ success: true });
    return true;
  }
});
