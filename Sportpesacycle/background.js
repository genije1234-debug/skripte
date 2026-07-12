// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Listen for messages from content-bridge
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle DOM selections - store ALL found selections
  if (message.type === 'DOM_SELECTION_FOUND') {
    const selections = message.data.selections || [];
    
    // Store all selections exactly as received
    const allOdds = selections.map(sel => ({
      eventId: sel.eventId,
      marketId: sel.marketId,
      eventName: sel.eventName,
      sportName: sel.sport,
      categoryName: sel.categoryName,
      yourPick: sel.yourPick,
      quota: sel.quota,
      timestamp: Date.now()
    }));
    
    chrome.storage.local.set({ allOdds: allOdds });
    return true;
  }
  
  // Handle cookies captured from profile endpoint
  if (message.type === 'COOKIES_CAPTURED') {
    console.log('📥 Background: Received cookies from profile endpoint');
    console.log('🍪 Cookies:', message.data.cookies);
    
    // Store cookies
    chrome.storage.local.set({ 
      capturedCookies: message.data.cookies,
      capturedCookiesRaw: message.data.rawCookies,
      cookiesTimestamp: message.data.timestamp
    }, () => {
      console.log('✅ Cookies stored successfully');
      console.log('📋 Cookie names:', Object.keys(message.data.cookies).join(', '));
      sendResponse({ success: true });
    });
    
    return true;
  }
  
  // Handle manual cookie capture request
  if (message.type === 'MANUAL_COOKIE_CAPTURE') {
    console.log('🔧 Manual cookie capture requested');
    
    const tabId = message.tabId;
    
    // STEP 1: Get cookies from document.cookie (includes third-party but NOT httpOnly)
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: 'MAIN',
      func: () => {
        return document.cookie;
      }
    }, (results) => {
      if (!results || !results[0]) {
        console.log('⚠️ Failed to capture cookies from page');
        sendResponse({ success: false });
        return;
      }
      
      const rawCookies = results[0].result;
      console.log('═══════════════════════════════════════');
      console.log('🍪 STEP 1: Cookies from document.cookie');
      console.log('📋 Raw:', rawCookies);
      
      // Parse document.cookie
      const cookieObj = {};
      if (rawCookies) {
        rawCookies.split(';').forEach(cookie => {
          const [name, value] = cookie.trim().split('=');
          if (name) {
            cookieObj[name] = value;
            console.log('  - [doc]', name, ':', value ? value.substring(0, 40) + '...' : 'empty');
          }
        });
      }
      
      // STEP 2: Get httpOnly cookies from Chrome API (like spkessid)
      chrome.cookies.getAll({ url: 'https://www.ke.sportpesa.com' }, (chromeCookies) => {
        console.log('🍪 STEP 2: Cookies from Chrome API (httpOnly included)');
        
        chromeCookies.forEach(cookie => {
          // Add or overwrite with Chrome API cookies (these include httpOnly)
          cookieObj[cookie.name] = cookie.value;
          const marker = cookie.httpOnly ? '[httpOnly]' : '[chrome]';
          console.log('  -', marker, cookie.name, ':', cookie.value.substring(0, 40) + '...');
        });
        
        // Rebuild raw cookie string with ALL cookies
        const allRawCookies = Object.keys(cookieObj).map(name => `${name}=${cookieObj[name]}`).join('; ');
        
        // Store cookies
        chrome.storage.local.set({ 
          capturedCookies: cookieObj,
          capturedCookiesRaw: allRawCookies,
          cookiesTimestamp: new Date().toISOString()
        }, () => {
          console.log('✅ Manual capture: ALL cookies stored (document + httpOnly)');
          console.log('📋 Total cookie count:', Object.keys(cookieObj).length);
          console.log('📋 Cookie names:', Object.keys(cookieObj).join(', '));
          console.log('═══════════════════════════════════════');
          sendResponse({ success: true, count: Object.keys(cookieObj).length });
        });
      });
    });
    
    return true;
  }
  
  // Handle fetch event details request
  if (message.type === 'FETCH_EVENT_DETAILS') {
    const tabId = message.tabId;
    const eventIds = message.eventIds;
    const slotNumber = message.slotNumber;
    
    // Inject script to make XHR requests for each event ID
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: 'MAIN',
      args: [eventIds, slotNumber],
      func: (eventIds, slotNumber) => {
        const results = [];
        let completed = 0;
        
        eventIds.forEach((eventId, index) => {
          const xhr = new XMLHttpRequest();
          const url = `https://www.ke.sportpesa.com/api/live/events/${eventId}/details`;
          
          xhr.open('GET', url, true);
          
          // Set only safe headers - browser will add sec-* headers sam
          xhr.setRequestHeader('accept', 'application/json, text/plain, */*');
          xhr.setRequestHeader('accept-language', 'en-US,en;q=0.9,it;q=0.8,sr;q=0.7,bs;q=0.6');
          xhr.setRequestHeader('x-app-timezone', 'Africa/Nairobi');
          
          xhr.onload = function() {
            // Parse response for both 200 and 404 (event not found)
            if (this.status === 200 || this.status === 404) {
              try {
                const data = JSON.parse(this.responseText);
                
                // Check if event not found (can be in 200 OR 404 response)
                if (data.msg === 'event not found' || data.message === 'event not found' || data.code === 107) {
                  results.push({
                    eventId: eventId,
                    success: false,
                    notFound: true,
                    error: 'Event not found'
                  });
                } else {
                  results.push({
                    eventId: eventId,
                    success: true,
                    data: data
                  });
                }
              } catch (e) {
                results.push({
                  eventId: eventId,
                  success: false,
                  error: 'Parse error'
                });
              }
            } else {
              // Other HTTP errors (500, 503, etc.)
              results.push({
                eventId: eventId,
                success: false,
                error: `HTTP ${this.status}`
              });
            }
            
            completed++;
            
            // When all requests are done, dispatch event
            if (completed === eventIds.length) {
              document.dispatchEvent(new CustomEvent('sportpesa_event_details', {
                detail: {
                  slotNumber: slotNumber,
                  results: results,
                  timestamp: new Date().toISOString()
                },
                bubbles: true
              }));
            }
          };
          
          xhr.onerror = function() {
            results.push({
              eventId: eventId,
              success: false,
              error: 'Network error'
            });
            completed++;
            
            if (completed === eventIds.length) {
              document.dispatchEvent(new CustomEvent('sportpesa_event_details', {
                detail: {
                  slotNumber: slotNumber,
                  results: results,
                  timestamp: new Date().toISOString()
                },
                bubbles: true
              }));
            }
          };
          
          xhr.send();
        });
      }
    });
    
    return true;
  }
  
  // Handle event details response
  if (message.type === 'EVENT_DETAILS_RESPONSE') {
    // Store results
    chrome.storage.local.set({
      [`slot${message.data.slotNumber}Details`]: message.data.results,
      [`slot${message.data.slotNumber}DetailsTimestamp`]: message.data.timestamp
    });
    
    return true;
  }
  
  // Handle bet placed response
  if (message.type === 'BET_PLACED_RESPONSE') {
    console.log('🎰 Bet placed response:', message.data);
    
    if (message.data.success) {
      console.log('✅ Bet placed successfully!');
      console.log('📊 Response data:', message.data.data);
    } else {
      console.log('❌ Bet placement failed:', message.data.error);
    }
    
    // Store response to trigger storage listener in sidepanel
    chrome.storage.local.set({
      lastBetResponse: message.data,
      lastBetTimestamp: Date.now()
    });
    
    return true;
  }
  
  // Handle passive prematch capture - store the latest manually placed prematch payload
  if (message.type === 'PREMATCH_CAPTURED') {
    try {
      const rawBody = message.data && message.data.body ? message.data.body : null;
      const parsed = rawBody ? JSON.parse(rawBody) : null;
      if (parsed && Array.isArray(parsed.bets) && parsed.bets.length > 0) {
        chrome.storage.local.set({
          prematchLastCaptured: {
            bets: parsed.bets,
            amount: parsed.amount,
            timestamp: (message.data && message.data.timestamp) || Date.now()
          }
        });
      }
    } catch (e) {
      // Ignore malformed capture payloads.
    }
    
    return true;
  }
  
  // Handle wallet balance status forwarded from content-bridge
  if (message.type === 'WALLET_BALANCE') {
    const { status, timestamp } = message.data || {};
    chrome.storage.local.set({
      lastWalletStatus: status,
      lastWalletStatusTimestamp: timestamp || new Date().toISOString()
    });
    return true;
  }
  
  // Handle place bet request
  if (message.type === 'PLACE_BET') {
    const { amount, selections, tabId } = message;
    
    console.log('🎯 Placing bet:', { amount, selections });
    
    // Inject script to place bet from page context
    chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: 'MAIN',
      args: [amount, selections],
      func: (amount, selections) => {
        // Build payload
        const payload = {
          amount: amount,
          selections: selections,
          acceptOdds: true
        };
        
        console.log('🚀 Sending place bet request:', payload);
        
        // Send fetch request
        fetch('https://www.ke.sportpesa.com/api/live/place', {
          method: 'POST',
          headers: {
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'en-US,en;q=0.9,it;q=0.8,sr;q=0.7,bs;q=0.6',
            'content-type': 'application/json;charset=UTF-8',
            'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
            'sec-ch-ua-mobile': '?0',
            'sec-ch-ua-platform': '"Windows"',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'x-app-timezone': 'Africa/Nairobi',
            'x-requested-with': 'XMLHttpRequest'
          },
          body: JSON.stringify(payload),
          credentials: 'include'
        })
        .then(response => response.json())
        .then(data => {
          console.log('✅ Place bet response:', data);
          
          // Dispatch event with response
          document.dispatchEvent(new CustomEvent('sportpesa_bet_placed', {
            detail: {
              success: true,
              data: data,
              timestamp: new Date().toISOString()
            },
            bubbles: true
          }));
        })
        .catch(error => {
          console.log('❌ Place bet error:', error);
          
          // Dispatch error event
          document.dispatchEvent(new CustomEvent('sportpesa_bet_placed', {
            detail: {
              success: false,
              error: error.message,
              timestamp: new Date().toISOString()
            },
            bubbles: true
          }));
        });
      }
    }).then(() => {
      sendResponse({ success: true });
    }).catch(error => {
      console.log('❌ Script injection error:', error);
      sendResponse({ success: false, error: error.message });
    });
    
    return true;
  }
  
  // Handle Mines auth data captured
  if (message.type === 'MINES_AUTH_CAPTURED') {
    console.log('🎰 Mines auth data received:', message.data);
    
    chrome.storage.local.set({
      minesAuthData: message.data,
      minesAuthTimestamp: Date.now()
    }, () => {
      console.log('✅ Mines auth data stored');
    });
    
    return true;
  }
  
  // Handle cashout response
  if (message.type === 'CASHOUT_RESPONSE') {
    console.log('💰 Cashout response received:', message.data);
    
    // Store in storage so sidepanel can read it
    chrome.storage.local.set({
      lastCashoutResponse: message.data,
      cashoutTimestamp: Date.now()
    });
    
    return true;
  }
});

// ============================================
// Periodic wallet balance polling (every 10s)
// ============================================

async function pollWalletBalance() {
  try {
    // Find an open SportPesa tab
    const tabs = await chrome.tabs.query({ url: '*://www.ke.sportpesa.com/*' });
    if (!tabs || tabs.length === 0) {
      return; // No SportPesa tab, skip
    }

    const tabId = tabs[0].id;

    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: () => {
        try {
          fetch('https://www.ke.sportpesa.com/api/wallets/balance', {
            method: 'GET',
            headers: {
              'accept': 'application/json, text/plain, */*',
              'accept-language': 'en-US,en;q=0.9',
              'sec-ch-ua': '"Chromium";v="142", "Google Chrome";v="142", "Not_A Brand";v="99"',
              'sec-ch-ua-mobile': '?0',
              'sec-ch-ua-platform': '"Windows"',
              'sec-fetch-dest': 'empty',
              'sec-fetch-mode': 'cors',
              'sec-fetch-site': 'same-origin',
              'x-app-timezone': 'Africa/Nairobi',
              'x-requested-with': 'XMLHttpRequest'
            },
            credentials: 'include'
          })
            .then(res => {
              const now = new Date();
              const timeStr = now.toLocaleTimeString(); // HH:MM:SS prema locale

              // Osnovni log sa vremenom
              console.log(`[${timeStr}] 💰 Wallet balance HTTP status:`, res.status);

              // "Lampica" u konzoli: zelena za 200, crvena za 402
              if (res.status === 200) {
                console.log('%c● BALANCE OK%c  ' + timeStr, 'color: #28a745; font-size:16px;', 'color: #999; font-size:11px;');
              } else if (res.status === 402) {
                console.log('%c● BALANCE 402%c  ' + timeStr, 'color: #dc3545; font-size:16px;', 'color: #999; font-size:11px;');
              }

              // Pošalji status ekstenziji kroz CustomEvent
              try {
                document.dispatchEvent(new CustomEvent('sportpesa_wallet_balance', {
                  detail: {
                    status: res.status,
                    timestamp: new Date().toISOString()
                  },
                  bubbles: true
                }));
              } catch (e) {
                console.log('⚠️ Failed to dispatch wallet balance event:', e);
              }

              return res.json().catch(() => null);
            })
            .then(data => {
              if (data) {
                console.log('💰 Wallet balance response:', data);
              } else {
                console.log('⚠️ Wallet balance: empty or non-JSON response');
              }
            })
            .catch(err => {
              console.log('❌ Wallet balance fetch error:', err);
            });
        } catch (e) {
          console.log('❌ Wallet balance polling exception:', e);
        }
      }
    });
  } catch (e) {
    console.log('❌ Failed to schedule wallet polling:', e);
  }
}

// Wallet balance polling disabled
// setInterval(pollWalletBalance, 5000);

// Track injected tabs
const injectedTabs = new Set();

// Intercept /api/users/profile requests at browser level to capture cookies
console.log('🔧 Setting up webRequest listener for profile endpoint...');

chrome.webRequest.onBeforeRequest.addListener(
  (details) => {
    console.log('═══════════════════════════════════════');
    console.log('🔐 PROFILE REQUEST INTERCEPTED AT BROWSER LEVEL');
    console.log('🌐 URL:', details.url);
    console.log('🌐 Method:', details.method);
    console.log('🌐 Type:', details.type);
    console.log('═══════════════════════════════════════');
    
    // Get cookies for this domain
    chrome.cookies.getAll({ url: 'https://www.ke.sportpesa.com' }, (cookies) => {
      console.log('🍪 Retrieved', cookies.length, 'cookies from Chrome API');
      
      const cookieObj = {};
      cookies.forEach(cookie => {
        cookieObj[cookie.name] = cookie.value;
        console.log('  -', cookie.name, '=', cookie.value.substring(0, 20) + '...');
      });
      
      // Store cookies
      chrome.storage.local.set({ 
        capturedCookies: cookieObj,
        capturedCookiesRaw: cookies.map(c => `${c.name}=${c.value}`).join('; '),
        cookiesTimestamp: new Date().toISOString()
      }, () => {
        console.log('✅ Cookies stored successfully to chrome.storage');
        console.log('📋 Cookie names:', Object.keys(cookieObj).join(', '));
        console.log('═══════════════════════════════════════');
      });
    });
  },
  { urls: ['https://www.ke.sportpesa.com/api/users/profile*'] }
);

console.log('✅ webRequest listener registered for:', 'https://www.ke.sportpesa.com/api/users/profile*');

// Inject XHR interceptor when page finishes loading
chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  // Log ALL tab updates for debugging
  if (tab.url && tab.url.includes('mines.turbogg4u.online')) {
    console.log('🔍 Mines tab update:', { tabId, status: info.status, url: tab.url });
  }
  
  // Clear tracking when page starts loading
  if (info.status === 'loading' && (tab.url && tab.url.includes('sportpesa.com'))) {
    injectedTabs.delete(tabId);
  }
  
  // Inject on complete for sportpesa
  if (info.status === 'complete' && tab.url && tab.url.includes('sportpesa.com')) {
    if (injectedTabs.has(tabId)) {
      console.log('⚠️ Already injected in tab:', tabId);
      return;
    }
    
    console.log('🔧 Injecting XHR interceptor into tab:', tabId);
    
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId, allFrames: true },
        world: 'MAIN',
        func: () => {
          if (window._xhrInterceptorInjected) {
            return;
          }
          window._xhrInterceptorInjected = true;
          
          // Store all data-qa attributes in memory
          window._dataQaMap = new Map();
          window._currentDisplayedEventId = null;
          window._lastSentMarketId = null;
          
          // Function to extract marketId from data-qa string
          const extractMarketId = (dataQa) => {
            if (!dataQa) return null;
            const parts = dataQa.split(',');
            return parts.length >= 4 ? parts[3] : null;
          };
          
          // Function to scan DOM and send found selection to background
          window._scanDataQa = () => {
            // Find all <li> elements with selection data-qa
            const betElements = document.querySelectorAll('li[data-qa^="selection-"]');
            
            if (betElements.length === 0) {
              // Send empty array to clear sidepanel
              document.dispatchEvent(new CustomEvent('sportpesa_dom_selection', {
                detail: {
                  selections: [],
                  timestamp: new Date().toISOString()
                },
                bubbles: true
              }));
              return;
            }
            
            // Extract ALL selections with full details
            const selections = [];
            betElements.forEach(li => {
              // 1. Game ID & Market ID from data-qa
              const dataQa = li.getAttribute('data-qa');
              if (!dataQa || !dataQa.includes(',')) return;
              
              const parts = dataQa.split(',');
              if (parts.length < 4) return;
              
              const eventId = parts[0].replace('selection-', '');
              const marketId = parts[3];
              
              // 2. SPORT from icon class
              const sportIcon = li.querySelector('.sport-icon');
              let sport = 'Unknown';
              if (sportIcon) {
                if (sportIcon.classList.contains('icon-live-1')) sport = 'Football';
                else if (sportIcon.classList.contains('icon-live-4')) sport = 'Tennis';
                else if (sportIcon.classList.contains('icon-live-2')) sport = 'Basketball';
                else if (sportIcon.classList.contains('icon-live-8')) sport = 'Ice Hockey';
                else sport = 'Other';
              }
              
              // 3. Event Name (players/teams)
              const eventName = li.querySelector('[data-qa="selection-event-description"]')?.textContent.trim() || 'N/A';
              
              // 4. Market Type
              const marketType = li.querySelector('[data-qa="selection-market"]')?.textContent.trim() || 'N/A';
              
              // 5. Your Pick
              const yourPick = li.querySelector('[data-qa="selection-your-pick"]')?.textContent.trim() || 'N/A';
              
              // 6. Quota
              const quota = li.querySelector('[data-qa="selection-your-odd"]')?.textContent.trim() || 'N/A';
              
              selections.push({
                eventId: eventId,
                marketId: marketId,
                sport: sport,
                eventName: eventName,
                categoryName: marketType,
                yourPick: yourPick,
                quota: quota
              });
            });
            
            // Send ALL selections with full data
            document.dispatchEvent(new CustomEvent('sportpesa_dom_selection', {
              detail: {
                selections: selections,
                timestamp: new Date().toISOString()
              },
              bubbles: true
            }));
          };
          
          // Initial scan
          window._scanDataQa();
          
          // Setup MutationObserver to track DOM changes
          const observer = new MutationObserver((mutations) => {
            let needsRescan = false;
            
            mutations.forEach(mutation => {
              // Check for added/removed nodes
              if (mutation.addedNodes.length > 0 || mutation.removedNodes.length > 0) {
                needsRescan = true;
              }
              
              // Check attribute changes
              if (mutation.type === 'attributes' && mutation.attributeName === 'data-qa') {
                needsRescan = true;
              }
            });
            
            if (needsRescan) {
              window._scanDataQa();
            }
          });
          
          // Start observing
          observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['data-qa']
          });
          
          // ALSO: Aggressive periodic rescan every 500ms (backup mechanism)
          setInterval(() => {
            if (window._scanDataQa) {
              window._scanDataQa();
            }
          }, 500);
          
          // Intercept navigator.sendBeacon
          const originalSendBeacon = navigator.sendBeacon.bind(navigator);
          navigator.sendBeacon = function(url, data) {
            
            if (data) {
              try {
                // Try to read data if it's a string
                if (typeof data === 'string') {
                  const parsed = JSON.parse(data);
                  
                  // Check for oddAddSuccess event
                  if (parsed.payload && parsed.payload.event === 'oddAddSuccess') {
                    // IMMEDIATELY rescan DOM to capture latest changes
                    if (window._scanDataQa) {
                      window._scanDataQa();
                    }
                    
                    const eventId = parsed.payload.sportEvent?.eventId;
                    const marketId = null; // Will be updated by DOM scanner
                    
                    const eventData = {
                      eventId: eventId,
                      eventName: parsed.payload.sportEvent?.eventName,
                      sportName: parsed.payload.sportEvent?.sportName,
                      categoryName: parsed.payload.odd?.categoryName,
                      quota: parsed.payload.odd?.quota,
                      marketId: marketId,
                      timestamp: parsed.timestamp || new Date().toISOString()
                    };
                    console.log('📊 Extracted Data:', eventData);
                    
                    // Send to content bridge via CustomEvent
                    document.dispatchEvent(new CustomEvent('sportpesa_odd_add', {
                      detail: eventData,
                      bubbles: true
                    }));
                  }
                } else if (data instanceof Blob) {
                  // Read blob data
                  data.text().then(text => {
                    console.log('📦 Blob Text:', text);
                    try {
                      const parsed = JSON.parse(text);
                      console.log('📦 Parsed Blob:', parsed);
                      
                      // Check for oddAddSuccess event
                      if (parsed.payload && parsed.payload.event === 'oddAddSuccess') {
                        console.log('🎯🎯🎯 ODD ADD SUCCESS DETECTED! 🎯🎯🎯');
                        
                        // IMMEDIATELY rescan DOM
                        console.log('⚡ IMMEDIATE DOM RESCAN triggered by oddAddSuccess');
                        if (window._scanDataQa) {
                          window._scanDataQa();
                        }
                        
                        const eventId = parsed.payload.sportEvent?.eventId;
                        const marketId = null; // Will be updated by DOM scanner
                        
                        const eventData = {
                          eventId: eventId,
                          eventName: parsed.payload.sportEvent?.eventName,
                          sportName: parsed.payload.sportEvent?.sportName,
                          categoryName: parsed.payload.odd?.categoryName,
                          quota: parsed.payload.odd?.quota,
                          marketId: marketId,
                          timestamp: parsed.timestamp || new Date().toISOString()
                        };
                        console.log('📊 Extracted Data:', eventData);
                        
                        document.dispatchEvent(new CustomEvent('sportpesa_odd_add', {
                          detail: eventData,
                          bubbles: true
                        }));
                      }
                    } catch (e) {
                      console.log('⚠️ Blob not JSON');
                    }
                  });
                } else {
                  console.log('📦 Data Type:', typeof data);
                }
              } catch (e) {
                console.log('⚠️ Could not parse data:', e);
              }
            }
            console.log('═══════════════════════════════════════');
            
            return originalSendBeacon(url, data);
          };
          
          // Intercept FETCH
          const originalFetch = window.fetch;
          window.fetch = function(...args) {
            const [url, options] = args;
            
            // Log ALL fetch requests for debugging
            console.log('🌐 FETCH:', url);
            
            // Intercept /api/users/profile to capture cookies
            if (url && url.includes('/api/users/profile')) {
              console.log('═══════════════════════════════════════');
              console.log('🔐 PROFILE REQUEST INTERCEPTED!');
              console.log('🌐 URL:', url);
              
              // Get all cookies
              const cookies = document.cookie;
              console.log('🍪 Cookies:', cookies);
              
              // Parse cookies into object
              const cookieObj = {};
              if (cookies) {
                cookies.split(';').forEach(cookie => {
                  const [name, value] = cookie.trim().split('=');
                  if (name) cookieObj[name] = value;
                });
              }
              
              console.log('📋 Parsed Cookies:', cookieObj);
              
              // Dispatch event with cookies
              document.dispatchEvent(new CustomEvent('sportpesa_cookies_captured', {
                detail: {
                  cookies: cookieObj,
                  rawCookies: cookies,
                  timestamp: new Date().toISOString()
                },
                bubbles: true
              }));
              
              console.log('✅ Cookies captured and dispatched');
              console.log('═══════════════════════════════════════');
            }
            
            // Intercept pixel.sussads.io requests (any path)
            if (url && url.includes('pixel.sussads.io')) {
              console.log('═══════════════════════════════════════');
              console.log('🎯 SUSSADS FETCH DETECTED!');
              console.log('🌐 URL:', url);
              console.log('📦 Method:', options?.method || 'GET');
              console.log('📦 Request Body:', options?.body);
              console.log('📦 Headers:', options?.headers);
              
              // Parse and log payload
              if (options?.body) {
                try {
                  const payload = JSON.parse(options.body);
                  console.log('📦 Parsed Payload:', payload);
                  
                  // Check for oddAddSuccess event
                  if (payload.payload && payload.payload.event === 'oddAddSuccess') {
                    console.log('🎯🎯🎯 ODD ADD SUCCESS DETECTED! 🎯🎯🎯');
                    
                    // IMMEDIATELY rescan DOM
                    console.log('⚡ IMMEDIATE DOM RESCAN triggered by oddAddSuccess');
                    if (window._scanDataQa) {
                      window._scanDataQa();
                    }
                    
                    const eventId = payload.payload.sportEvent?.eventId;
                    const marketId = null; // Will be updated by DOM scanner
                    
                    const eventData = {
                      eventId: eventId,
                      eventName: payload.payload.sportEvent?.eventName,
                      sportName: payload.payload.sportEvent?.sportName,
                      categoryName: payload.payload.odd?.categoryName,
                      quota: payload.payload.odd?.quota,
                      marketId: marketId,
                      timestamp: payload.timestamp || new Date().toISOString()
                    };
                    console.log('📊 Extracted Data:', eventData);
                    
                    document.dispatchEvent(new CustomEvent('sportpesa_odd_add', {
                      detail: eventData,
                      bubbles: true
                    }));
                  }
                  
                  console.log('═══════════════════════════════════════');
                } catch (e) {
                  console.log('⚠️ Could not parse body:', e);
                  console.log('═══════════════════════════════════════');
                }
              }
              
              // Continue with original fetch and log response
              return originalFetch.apply(this, args).then(response => {
                console.log('📥 SUSSADS Response Status:', response.status);
                return response;
              }).catch(error => {
                console.log('❌ SUSSADS Fetch Error:', error);
                throw error;
              });
            }
            
            // PREMATCH capture (passive): record real prematch placement payload.
            // Live betting uses /api/live/place, so this branch never touches the live flow.
            if (url && typeof url === 'string' && url.includes('/api/bets/place')) {
              try {
                const prematchBody = options && options.body ? options.body : null;
                if (typeof prematchBody === 'string' && prematchBody.indexOf('bets') !== -1) {
                  document.dispatchEvent(new CustomEvent('sportpesa_prematch_captured', {
                    detail: { body: prematchBody, timestamp: new Date().toISOString() },
                    bubbles: true
                  }));
                }
              } catch (e) {
                // Never break the original request because of capture.
              }
            }
            
            // For all other requests
            return originalFetch.apply(this, args);
          };
          
          // Intercept XHR
          const OriginalXHR = XMLHttpRequest;
          window._OriginalXHR = OriginalXHR;
          
          window.XMLHttpRequest = function() {
            const xhr = new OriginalXHR();
            const originalOpen = xhr.open;
            const originalSend = xhr.send;
            
            xhr.open = function(method, url, ...args) {
              this._url = url;
              this._method = method;
              return originalOpen.apply(this, [method, url, ...args]);
            };
            
            xhr.send = function(data) {
              // Intercept /api/users/profile to capture cookies
              if (this._url && this._url.includes('/api/users/profile')) {
                console.log('═══════════════════════════════════════');
                console.log('🔐 PROFILE XHR INTERCEPTED!');
                console.log('🌐 URL:', this._url);
                console.log('🌐 Method:', this._method);
                
                // Get all cookies
                const cookies = document.cookie;
                console.log('🍪 Cookies:', cookies);
                
                // Parse cookies into object
                const cookieObj = {};
                if (cookies) {
                  cookies.split(';').forEach(cookie => {
                    const [name, value] = cookie.trim().split('=');
                    if (name) cookieObj[name] = value;
                  });
                }
                
                console.log('📋 Parsed Cookies:', cookieObj);
                
                // Dispatch event with cookies
                document.dispatchEvent(new CustomEvent('sportpesa_cookies_captured', {
                  detail: {
                    cookies: cookieObj,
                    rawCookies: cookies,
                    timestamp: new Date().toISOString()
                  },
                  bubbles: true
                }));
                
                console.log('✅ Cookies captured and dispatched from XHR');
                console.log('═══════════════════════════════════════');
              }
              
              // Handle sussads requests (any path)
              if (this._url && this._url.includes('pixel.sussads.io')) {
                console.log('📤 XHR SEND - SUSSADS');
                console.log('📦 Request Payload:', data);
                
                // Parse and log payload
                if (data) {
                  try {
                    const payload = JSON.parse(data);
                    console.log('📦 Parsed Payload:', payload);
                    
                    // Check for oddAddSuccess event
                    if (payload.payload && payload.payload.event === 'oddAddSuccess') {
                      console.log('🎯🎯🎯 ODD ADD SUCCESS DETECTED! 🎯🎯🎯');
                      
                      // IMMEDIATELY rescan DOM
                      console.log('⚡ IMMEDIATE DOM RESCAN triggered by oddAddSuccess');
                      if (window._scanDataQa) {
                        window._scanDataQa();
                      }
                      
                      const eventId = payload.payload.sportEvent?.eventId;
                      const marketId = null; // Will be updated by DOM scanner
                      
                      const eventData = {
                        eventId: eventId,
                        eventName: payload.payload.sportEvent?.eventName,
                        sportName: payload.payload.sportEvent?.sportName,
                        categoryName: payload.payload.odd?.categoryName,
                        quota: payload.payload.odd?.quota,
                        marketId: marketId,
                        timestamp: payload.timestamp || new Date().toISOString()
                      };
                      console.log('📊 Extracted Data:', eventData);
                      
                      document.dispatchEvent(new CustomEvent('sportpesa_odd_add', {
                        detail: eventData,
                        bubbles: true
                      }));
                    }
                  } catch (e) {
                    console.log('⚠️ Could not parse payload:', e);
                  }
                }
                
                // Add response listener
                xhr.addEventListener('readystatechange', function() {
                  if (this.readyState === 4) {
                    console.log('📥 SUSSADS XHR Response Status:', this.status);
                    console.log('📥 Response:', this.responseText);
                    console.log('═══════════════════════════════════════');
                  }
                });
              }
              
              // PREMATCH capture (passive): record real prematch placement payload via XHR.
              // Live betting uses /api/live/place, so this branch never touches the live flow.
              if (this._url && String(this._url).includes('/api/bets/place')) {
                try {
                  const prematchXhrBody = typeof data === 'string' ? data : null;
                  if (prematchXhrBody && prematchXhrBody.indexOf('bets') !== -1) {
                    document.dispatchEvent(new CustomEvent('sportpesa_prematch_captured', {
                      detail: { body: prematchXhrBody, timestamp: new Date().toISOString() },
                      bubbles: true
                    }));
                  }
                } catch (e) {
                  // Never break the original request because of capture.
                }
              }
              
              return originalSend.apply(this, arguments);
            };
            
            return xhr;
          };
          
          // Listen for cashout commands from content script
          window.addEventListener('message', (event) => {
            if (event.data.type === 'SEND_CASHOUT') {
              console.log('💰 Received cashout command:', event.data.data);
              const { betId, cashoutType, valueOperation, valueOperationTax, totalValueOperation, family } = event.data.data;
              
              const xhr = new XMLHttpRequest();
              xhr.open("POST", "https://www.ke.sportpesa.com/api/bets/cashout", true);
              xhr.setRequestHeader("accept", "application/json, text/plain, */*");
              xhr.setRequestHeader("accept-language", "en-US,en;q=0.9");
              xhr.setRequestHeader("content-type", "application/json;charset=UTF-8");
              xhr.setRequestHeader("x-app-timezone", "Africa/Nairobi");
              xhr.setRequestHeader("x-requested-with", "XMLHttpRequest");
              
              xhr.onload = function() {
                console.log('💰 Cashout response status:', xhr.status);
                if (xhr.status >= 200 && xhr.status < 300) {
                  const data = JSON.parse(xhr.responseText);
                  console.log('✅ Cashout successful:', data);
                  window.postMessage({ type: 'CASHOUT_RESPONSE', data: { success: true, data: data, betId: betId } }, '*');
                } else {
                  console.log('❌ Cashout failed:', xhr.status);
                  window.postMessage({ type: 'CASHOUT_RESPONSE', data: { success: false, error: `HTTP ${xhr.status}`, betId: betId } }, '*');
                }
              };
              
              xhr.onerror = () => {
                console.log('❌ Cashout network error');
                window.postMessage({ type: 'CASHOUT_RESPONSE', data: { success: false, error: 'Network error', betId: betId } }, '*');
              };
              
              const payload = `{"betId":"${betId}","details":{"cashoutType":"${cashoutType}","valueOperation":${valueOperation},"valueOperationTax":${valueOperationTax},"totalValueOperation":${totalValueOperation},"betId":"${betId}","family":"${family}"}}`;
              console.log('📤 Sending cashout:', payload);
              xhr.send(payload);
            }
          });
          
          console.log('✅ XHR & Fetch Interceptor + Cashout Listener ACTIVE for SportPesa');
        }
      });
      
      injectedTabs.add(tabId);
      console.log('✅ XHR interceptor injected successfully in tab:', tabId);
    } catch (error) {
      console.error('❌ Failed to inject interceptor:', error);
    }
  }
});

// Inject interceptor for Mines game tabs
const minesInjectedTabs = new Set();

chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  // Clear tracking when page starts loading
  if (info.status === 'loading' && tab.url && tab.url.includes('mines.turbogg4u.online')) {
    minesInjectedTabs.delete(tabId);
    console.log('🔄 Mines tab reloading - cleared injection tracking:', tabId);
  }
  
  // Inject on complete for mines.turbogg4u.online
  if (tab.url && tab.url.includes('mines.turbogg4u.online')) {
    console.log('🔍 Mines tab - checking injection:', { 
      tabId, 
      status: info.status, 
      alreadyInjected: minesInjectedTabs.has(tabId) 
    });
  }
  
  if (info.status === 'complete' && tab.url && tab.url.includes('mines.turbogg4u.online')) {
    if (minesInjectedTabs.has(tabId)) {
      console.log('⚠️ Mines interceptor already injected in tab:', tabId);
      return;
    }
    
    console.log('🎰 Injecting Mines interceptor into tab:', tabId);
    
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        world: 'MAIN',
        func: () => {
          if (window._minesInterceptorInjected) {
            return;
          }
          window._minesInterceptorInjected = true;
          
          console.log('🎰 Mines interceptor active');
          
          // Store captured data
          window._minesAuthData = {
            authorization: null,
            apikey: null,
            roundId: null,
            timestamp: null
          };
          
          // Intercept XHR
          const OriginalXHR = XMLHttpRequest;
          window.XMLHttpRequest = function() {
            const xhr = new OriginalXHR();
            const originalOpen = xhr.open;
            const originalSend = xhr.send;
            const originalSetRequestHeader = xhr.setRequestHeader;
            
            xhr._headers = {};
            xhr._url = '';
            
            xhr.setRequestHeader = function(name, value) {
              xhr._headers[name] = value;
              
              if (name.toLowerCase() === 'authorization') {
                window._minesAuthData.authorization = value;
                console.log('✅ Captured authorization (XHR)');
              }
              if (name.toLowerCase() === 'apikey') {
                window._minesAuthData.apikey = value;
                console.log('✅ Captured apikey (XHR):', value);
              }
              
              return originalSetRequestHeader.apply(this, arguments);
            };
            
            xhr.open = function(method, url, ...args) {
              xhr._url = url;
              return originalOpen.apply(this, [method, url, ...args]);
            };
            
            xhr.send = function(data) {
              // Capture from /api/games/retrieve
              if (xhr._url && xhr._url.includes('/api/games/retrieve')) {
                console.log('🎮 XHR to /api/games/retrieve detected');
                
                // Send to content script after headers are set
                setTimeout(() => {
                  if (window._minesAuthData.authorization && window._minesAuthData.apikey) {
                    window.postMessage({
                      type: 'MINES_AUTH_CAPTURED',
                      data: window._minesAuthData
                    }, '*');
                  }
                }, 100);
              }
              
              // Capture roundId from bet requests
              if (xhr._url && xhr._url.includes('/api/bets/') && data) {
                try {
                  const body = JSON.parse(data);
                  if (body.roundId) {
                    window._minesAuthData.roundId = body.roundId;
                    window._minesAuthData.timestamp = Date.now();
                    console.log('✅ Captured roundId (XHR):', body.roundId);
                    
                    // Send to content script
                    window.postMessage({
                      type: 'MINES_AUTH_CAPTURED',
                      data: window._minesAuthData
                    }, '*');
                  }
                } catch (e) {
                  // Not JSON or no roundId
                }
              }
              
              return originalSend.apply(this, arguments);
            };
            
            return xhr;
          };
          
          // Also intercept fetch as fallback
          const originalFetch = window.fetch;
          window.fetch = function(...args) {
            const [url, options] = args;
            
            // Capture roundId from fetch bet requests
            if (url && url.includes('/api/bets/') && options && options.body) {
              try {
                const body = JSON.parse(options.body);
                if (body.roundId) {
                  window._minesAuthData.roundId = body.roundId;
                  window._minesAuthData.timestamp = Date.now();
                  console.log('✅ Captured roundId (fetch):', body.roundId);
                  
                  window.postMessage({
                    type: 'MINES_AUTH_CAPTURED',
                    data: window._minesAuthData
                  }, '*');
                }
              } catch (e) {
                // Not JSON or no roundId
              }
            }
            
            return originalFetch.apply(this, args);
          };
          
          console.log('✅ Mines XHR & Fetch interceptor installed');
        }
      });
      
      minesInjectedTabs.add(tabId);
      console.log('✅ Mines interceptor injected successfully');
    } catch (error) {
      console.error('❌ Failed to inject Mines interceptor:', error);
    }
  }
});

// Clean up when tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  injectedTabs.delete(tabId);
  minesInjectedTabs.delete(tabId);
});
