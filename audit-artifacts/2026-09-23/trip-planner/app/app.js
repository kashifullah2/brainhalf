const state = {
  user: null,
  trips: [],
  items: [],
  selectedTripId: null,
  tripDetail: null,
  pendingRequests: new Set(),
  idempotencyKeys: new Map()
};

const elements = {};

function $(id) {
  return document.getElementById(id);
}

function initElements() {
  elements.loadingState = $('loading-state');
  elements.errorState = $('error-state');
  elements.signedOutView = $('signed-out-view');
  elements.signedInView = $('signed-in-view');
  elements.userEmail = $('user-email');
  elements.signinLink = $('signin-link');
  elements.logoutBtn = $('logout-btn');
  elements.createTripForm = $('create-trip-form');
  elements.createTripBtn = $('create-trip-btn');
  elements.tripsList = $('trips-list');
  elements.tripsEmpty = $('trips-empty');
  elements.addItemForm = $('add-item-form');
  elements.addItemBtn = $('add-item-btn');
  elements.itemsList = $('items-list');
  elements.itemsEmpty = $('items-empty');
  elements.tripDetailSection = $('trip-detail-section');
  elements.tripDetailTitle = $('trip-detail-title');
  elements.tripDetailContent = $('trip-detail-content');
  elements.contactForm = $('contact-form');
  elements.contactBtn = $('contact-btn');
  elements.contactResult = $('contact-result');
}

function showLoading() {
  elements.loadingState.classList.remove('hidden');
  elements.errorState.classList.add('hidden');
  elements.signedOutView.classList.add('hidden');
  elements.signedInView.classList.add('hidden');
}

function showError(message) {
  elements.loadingState.classList.add('hidden');
  elements.errorState.textContent = message;
  elements.errorState.classList.remove('hidden');
}

function showSignedOut() {
  elements.loadingState.classList.add('hidden');
  elements.errorState.classList.add('hidden');
  elements.signedOutView.classList.remove('hidden');
  elements.signedInView.classList.add('hidden');
}

function showSignedIn() {
  elements.loadingState.classList.add('hidden');
  elements.errorState.classList.add('hidden');
  elements.signedOutView.classList.add('hidden');
  elements.signedInView.classList.remove('hidden');
}

function setPending(key, pending) {
  if (pending) {
    state.pendingRequests.add(key);
  } else {
    state.pendingRequests.delete(key);
  }
  updateButtons();
}

function isPending(key) {
  return state.pendingRequests.has(key);
}

function updateButtons() {
  elements.createTripBtn.disabled = isPending('create-trip');
  elements.addItemBtn.disabled = isPending('add-item');
  elements.contactBtn.disabled = isPending('contact');
  
  document.querySelectorAll('[data-pending-key]').forEach(btn => {
    btn.disabled = isPending(btn.dataset.pendingKey);
  });
}

function generateIdempotencyKey() {
  return crypto.randomUUID();
}

function getOrCreateIdempotencyKey(operationKey) {
  if (!state.idempotencyKeys.has(operationKey)) {
    state.idempotencyKeys.set(operationKey, generateIdempotencyKey());
  }
  return state.idempotencyKeys.get(operationKey);
}

function clearIdempotencyKey(operationKey) {
  state.idempotencyKeys.delete(operationKey);
}

async function apiFetch(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  
  const data = await response.json().catch(() => ({}));
  
  if (!response.ok) {
    throw new Error(data.error || `Request failed with status ${response.status}`);
  }
  
  return data;
}

async function loadSession() {
  try {
    const data = await apiFetch('/api/auth/session');
    state.user = data.user || null;
    if (state.user) {
      elements.userEmail.textContent = state.user.email || '';
      elements.signinLink.classList.add('hidden');
      elements.logoutBtn.classList.remove('hidden');
      showSignedIn();
      await Promise.all([loadTrips(), loadItems()]);
    } else {
      elements.userEmail.textContent = '';
      elements.signinLink.classList.remove('hidden');
      elements.logoutBtn.classList.add('hidden');
      showSignedOut();
    }
  } catch (err) {
    showError(`Failed to load session: ${err.message}`);
  }
}

async function loadTrips() {
  try {
    const data = await apiFetch('/api/trips');
    state.trips = data.trips || [];
    renderTrips();
  } catch (err) {
    showError(`Failed to load trips: ${err.message}`);
  }
}

async function loadItems() {
  try {
    const data = await apiFetch('/api/items');
    state.items = data.items || [];
    renderItems();
  } catch (err) {
    showError(`Failed to load destinations: ${err.message}`);
  }
}

function renderTrips() {
  elements.tripsList.innerHTML = '';
  if (state.trips.length === 0) {
    elements.tripsEmpty.classList.remove('hidden');
    return;
  }
  elements.tripsEmpty.classList.add('hidden');
  
  state.trips.forEach(trip => {
    const row = document.createElement('div');
    row.className = 'trip-row';
    
    const info = document.createElement('div');
    info.className = 'trip-info';
    info.innerHTML = `
      <div class="trip-title">${escapeHtml(trip.title)}</div>
      <div class="trip-meta">Capacity: ${trip.capacity} | Budget: $${(trip.budget_cents / 100).toFixed(2)} | Reserved: ${trip.reserved_seats}</div>
    `;
    
    const actions = document.createElement('div');
    actions.className = 'trip-actions';
    
    const viewBtn = document.createElement('button');
    viewBtn.className = 'btn btn-secondary btn-small';
    viewBtn.textContent = 'View';
    viewBtn.dataset.pendingKey = `view-trip-${trip.id}`;
    viewBtn.addEventListener('click', () => selectTrip(trip.id));
    
    actions.appendChild(viewBtn);
    row.appendChild(info);
    row.appendChild(actions);
    elements.tripsList.appendChild(row);
  });
}

function renderItems() {
  elements.itemsList.innerHTML = '';
  if (state.items.length === 0) {
    elements.itemsEmpty.classList.remove('hidden');
    return;
  }
  elements.itemsEmpty.classList.add('hidden');
  
  state.items.forEach(item => {
    const row = document.createElement('div');
    row.className = 'item-row';
    
    const info = document.createElement('div');
    info.className = 'item-info';
    info.innerHTML = `
      <div class="item-title">${escapeHtml(item.title)}</div>
      <div class="item-meta">${new Date(item.created_at).toLocaleDateString()}</div>
    `;
    
    const actions = document.createElement('div');
    actions.className = 'item-actions';
    
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'btn btn-danger btn-small';
    deleteBtn.textContent = 'Delete';
    deleteBtn.dataset.pendingKey = `delete-item-${item.id}`;
    deleteBtn.addEventListener('click', () => deleteItem(item.id));
    
    actions.appendChild(deleteBtn);
    row.appendChild(info);
    row.appendChild(actions);
    elements.itemsList.appendChild(row);
  });
}

async function selectTrip(tripId) {
  const pendingKey = `view-trip-${tripId}`;
  setPending(pendingKey, true);
  try {
    const data = await apiFetch(`/api/trips/${tripId}`);
    state.selectedTripId = tripId;
    state.tripDetail = data;
    renderTripDetail();
  } catch (err) {
    showError(`Failed to load trip: ${err.message}`);
  } finally {
    setPending(pendingKey, false);
  }
}

function renderTripDetail() {
  if (!state.tripDetail) return;
  
  const { trip, members, bookings, expenses, spentCents } = state.tripDetail;
  elements.tripDetailSection.classList.remove('hidden');
  elements.tripDetailTitle.textContent = trip.title;
  
  const isOwner = state.user && trip.owner_id === state.user.id;
  
  elements.tripDetailContent.innerHTML = `
    <div class="trip-detail-grid">
      <div class="detail-card">
        <h3>Trip Info</h3>
        <div class="trip-meta">
          <div>Capacity: ${trip.capacity}</div>
          <div>Reserved seats: ${trip.reserved_seats}</div>
          <div>Budget: $${(trip.budget_cents / 100).toFixed(2)}</div>
          <div>Spent: $${(spentCents / 100).toFixed(2)}</div>
          <div>Version: ${trip.version}</div>
        </div>
        ${isOwner ? `
          <div class="inline-form" style="margin-top: 1rem;">
            <div class="field"><label for="rename-title">New trip title</label><input type="text" id="rename-title" maxlength="120" value="${escapeHtml(trip.title)}"></div>
            <button class="btn btn-secondary btn-small" id="rename-btn" data-pending-key="rename-trip">Rename</button>
          </div>
          <div id="rename-result" class="confirmation-message hidden"></div>
        ` : ''}
      </div>
      
      <div class="detail-card">
        <h3>Members (${members.length})</h3>
        <div class="member-list">
          ${members.map(m => `
            <div class="member-row">
              <span>${escapeHtml(m.user_id)}</span>
              <span class="trip-meta">${new Date(m.joined_at).toLocaleDateString()}</span>
            </div>
          `).join('')}
        </div>
        ${isOwner ? `
          <div class="inline-form" style="margin-top: 1rem;">
            <div class="field"><label for="member-id">Teammate user ID</label><input type="text" id="member-id" maxlength="128" placeholder="e.g. bob"></div>
            <button class="btn btn-secondary btn-small" id="invite-btn" data-pending-key="invite-member">Invite</button>
          </div>
          <div id="invite-result" class="confirmation-message hidden"></div>
        ` : ''}
      </div>
    </div>
    
    <div class="trip-detail-grid">
      <div class="detail-card">
        <h3>Bookings</h3>
        <div class="inline-form">
          <div class="field"><label for="booking-seats">Seats to book</label><input type="number" id="booking-seats" min="1" max="${trip.capacity}" step="1"></div>
          <button class="btn btn-primary btn-small" id="book-btn" data-pending-key="book-seats">Book Seats</button>
        </div>
        <div id="booking-result" class="confirmation-message hidden"></div>
        <div id="cancel-confirmation" class="confirmation-message hidden" role="group" aria-label="Confirm cancellation">
          <p>Cancel this booking and release its seats?</p>
          <button class="btn btn-secondary" id="keep-booking-btn">Keep booking</button>
          <button class="btn btn-danger" id="confirm-cancel-btn">Cancel booking</button>
        </div>
        <div class="booking-list">
          ${bookings.map(b => `
            <div class="booking-row ${b.status === 'cancelled' ? 'cancelled' : ''}">
              <span>${escapeHtml(b.user_id)} - ${b.seats} seat(s)</span>
              <span class="trip-meta">${b.status}</span>
              ${b.status === 'active' && (isOwner || b.user_id === state.user.id) ? `
                <button class="btn btn-danger btn-small cancel-booking-btn" data-booking-id="${b.id}" data-pending-key="cancel-booking-${b.id}">Cancel</button>
              ` : ''}
            </div>
          `).join('')}
        </div>
      </div>
      
      <div class="detail-card">
        <h3>Expenses</h3>
        <div class="inline-form">
          <div class="field"><label for="expense-description">Expense description</label><input type="text" id="expense-description" maxlength="500" placeholder="e.g. Mountain jeep"></div>
          <div class="field"><label for="expense-amount">Amount in dollars</label><input type="number" id="expense-amount" min="0.01" max="1000000" step="0.01"></div>
          <button class="btn btn-primary btn-small" id="add-expense-btn" data-pending-key="add-expense">Add Expense</button>
        </div>
        <div id="expense-result" class="confirmation-message hidden"></div>
        <div class="expense-list">
          ${expenses.map(e => `
            <div class="expense-row">
              <span>${escapeHtml(e.description)}</span>
              <span class="expense-amount">$${(e.amount_cents / 100).toFixed(2)}</span>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
    
    ${isOwner ? `
      <div class="detail-card">
        <h3>Audit Log</h3>
        <button class="btn btn-secondary btn-small" id="load-audit-btn" data-pending-key="load-audit">Load Audit</button>
        <div id="audit-list" class="audit-list" style="margin-top: 1rem;"></div>
      </div>
    ` : ''}
  `;
  
  if (isOwner) {
    $('rename-btn').addEventListener('click', renameTrip);
    $('invite-btn').addEventListener('click', inviteMember);
    $('load-audit-btn').addEventListener('click', loadAudit);
  }
  
  $('book-btn').addEventListener('click', bookSeats);
  $('add-expense-btn').addEventListener('click', addExpense);
  
  document.querySelectorAll('.cancel-booking-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $('cancel-confirmation').classList.remove('hidden');
      $('keep-booking-btn').onclick = () => { $('cancel-confirmation').classList.add('hidden'); btn.focus(); };
      $('confirm-cancel-btn').onclick = () => { $('confirm-cancel-btn').disabled = true; void cancelBooking(btn.dataset.bookingId); };
      $('keep-booking-btn').focus();
    });
  });
  document.querySelectorAll('.confirmation-message').forEach(message => message.setAttribute('role', message.id === 'cancel-confirmation' ? 'group' : 'status'));
  updateButtons();
}

async function renameTrip() {
  const titleInput = $('rename-title');
  const resultDiv = $('rename-result');
  const title = titleInput.value.trim();
  
  if (!title) {
    resultDiv.textContent = 'Title required';
    resultDiv.className = 'confirmation-message error';
    resultDiv.classList.remove('hidden');
    return;
  }
  
  setPending('rename-trip', true);
  try {
    const data = await apiFetch(`/api/trips/${state.selectedTripId}`, {
      method: 'PATCH',
      body: JSON.stringify({ title, version: state.tripDetail.trip.version })
    });
    state.tripDetail.trip = data.trip;
    resultDiv.textContent = 'Trip renamed successfully';
    resultDiv.className = 'confirmation-message success';
    resultDiv.classList.remove('hidden');
    renderTripDetail();
    await loadTrips();
  } catch (err) {
    resultDiv.textContent = err.message;
    resultDiv.className = 'confirmation-message error';
    resultDiv.classList.remove('hidden');
  } finally {
    setPending('rename-trip', false);
  }
}

async function inviteMember() {
  const memberIdInput = $('member-id');
  const resultDiv = $('invite-result');
  const userId = memberIdInput.value.trim();
  
  if (!userId) {
    resultDiv.textContent = 'User ID required';
    resultDiv.className = 'confirmation-message error';
    resultDiv.classList.remove('hidden');
    return;
  }
  
  setPending('invite-member', true);
  try {
    await apiFetch(`/api/trips/${state.selectedTripId}/members`, {
      method: 'POST',
      body: JSON.stringify({ userId })
    });
    resultDiv.textContent = 'Member invited successfully';
    resultDiv.className = 'confirmation-message success';
    resultDiv.classList.remove('hidden');
    memberIdInput.value = '';
    await selectTrip(state.selectedTripId);
  } catch (err) {
    resultDiv.textContent = err.message;
    resultDiv.className = 'confirmation-message error';
    resultDiv.classList.remove('hidden');
  } finally {
    setPending('invite-member', false);
  }
}

async function bookSeats() {
  const seatsInput = $('booking-seats');
  const resultDiv = $('booking-result');
  const seats = Number(seatsInput.value);
  
  if (!Number.isInteger(seats) || seats < 1) {
    resultDiv.textContent = 'Seats must be a positive integer';
    resultDiv.className = 'confirmation-message error';
    resultDiv.classList.remove('hidden');
    return;
  }
  
  const operationKey = `book-${state.selectedTripId}-${seats}`;
  const idempotencyKey = getOrCreateIdempotencyKey(operationKey);
  
  setPending('book-seats', true);
  try {
    await apiFetch(`/api/trips/${state.selectedTripId}/bookings`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ seats })
    });
    clearIdempotencyKey(operationKey);
    resultDiv.textContent = `Booked ${seats} seat(s) successfully`;
    resultDiv.className = 'confirmation-message success';
    resultDiv.classList.remove('hidden');
    seatsInput.value = '';
    await selectTrip(state.selectedTripId);
  } catch (err) {
    resultDiv.textContent = err.message;
    resultDiv.className = 'confirmation-message error';
    resultDiv.classList.remove('hidden');
  } finally {
    setPending('book-seats', false);
  }
}

async function cancelBooking(bookingId) {
  const pendingKey = `cancel-booking-${bookingId}`;
  setPending(pendingKey, true);
  try {
    await apiFetch(`/api/trips/${state.selectedTripId}/bookings/${bookingId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'cancelled' })
    });
    await selectTrip(state.selectedTripId);
  } catch (err) {
    showError(`Failed to cancel booking: ${err.message}`);
  } finally {
    setPending(pendingKey, false);
    if ($('confirm-cancel-btn')) $('confirm-cancel-btn').disabled = false;
  }
}

async function addExpense() {
  const descriptionInput = $('expense-description');
  const amountInput = $('expense-amount');
  const resultDiv = $('expense-result');
  const description = descriptionInput.value.trim();
  const amountCents = dollarsToCents(amountInput.value);
  
  if (!description) {
    resultDiv.textContent = 'Description required';
    resultDiv.className = 'confirmation-message error';
    resultDiv.classList.remove('hidden');
    return;
  }
  
  if (amountCents === null) {
    resultDiv.textContent = 'Use at most two decimal places for cents.';
    resultDiv.className = 'confirmation-message error';
    resultDiv.classList.remove('hidden');
    return;
  }
  
  if (amountCents < 1 || amountCents > 100000000) {
    resultDiv.textContent = 'Amount out of range';
    resultDiv.className = 'confirmation-message error';
    resultDiv.classList.remove('hidden');
    return;
  }
  
  const operationKey = `expense-${state.selectedTripId}-${description}-${amountCents}`;
  const idempotencyKey = getOrCreateIdempotencyKey(operationKey);
  
  setPending('add-expense', true);
  try {
    await apiFetch(`/api/trips/${state.selectedTripId}/expenses`, {
      method: 'POST',
      headers: { 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ description, amountCents })
    });
    clearIdempotencyKey(operationKey);
    resultDiv.textContent = 'Expense added successfully';
    resultDiv.className = 'confirmation-message success';
    resultDiv.classList.remove('hidden');
    descriptionInput.value = '';
    amountInput.value = '';
    await selectTrip(state.selectedTripId);
  } catch (err) {
    resultDiv.textContent = err.message;
    resultDiv.className = 'confirmation-message error';
    resultDiv.classList.remove('hidden');
  } finally {
    setPending('add-expense', false);
  }
}

async function loadAudit() {
  const auditList = $('audit-list');
  setPending('load-audit', true);
  try {
    const data = await apiFetch(`/api/trips/${state.selectedTripId}/audit`);
    const events = data.events || [];
    
    if (events.length === 0) {
      auditList.innerHTML = '<div class="state-message">No audit events</div>';
    } else {
      auditList.innerHTML = events.map(e => `
        <div class="audit-row">
          <div class="audit-event-type">${escapeHtml(e.event_type)}</div>
          <div class="audit-details">${escapeHtml(e.details)}</div>
          <div class="audit-details">${new Date(e.created_at).toLocaleString()}</div>
        </div>
      `).join('');
    }
  } catch (err) {
    auditList.innerHTML = `<div class="state-message error">${escapeHtml(err.message)}</div>`;
  } finally {
    setPending('load-audit', false);
  }
}

async function deleteItem(itemId) {
  const pendingKey = `delete-item-${itemId}`;
  setPending(pendingKey, true);
  try {
    await apiFetch(`/api/items/${itemId}`, { method: 'DELETE' });
    await loadItems();
  } catch (err) {
    showError(`Failed to delete destination: ${err.message}`);
  } finally {
    setPending(pendingKey, false);
  }
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);
}

function dollarsToCents(value) {
  if (!/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) ? cents : null;
}

async function handleCreateTrip(event) {
  event.preventDefault();
  const title = $('trip-title').value.trim();
  const capacity = Number($('trip-capacity').value);
  const budgetCents = dollarsToCents($('trip-budget').value);
  
  if (!title) {
    showError('Trip title required');
    return;
  }
  
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > 100) {
    showError('Capacity must be 1-100');
    return;
  }
  
  if (budgetCents === null || budgetCents < 0) {
    showError('Budget must use at most two decimal places');
    return;
  }
  
  if (budgetCents > 100000000) {
    showError('Budget too large');
    return;
  }
  
  setPending('create-trip', true);
  try {
    await apiFetch('/api/trips', {
      method: 'POST',
      body: JSON.stringify({ title, capacity, budgetCents })
    });
    $('trip-title').value = '';
    $('trip-capacity').value = '10';
    $('trip-budget').value = '1000';
    await loadTrips();
  } catch (err) {
    showError(`Failed to create trip: ${err.message}`);
  } finally {
    setPending('create-trip', false);
  }
}

async function handleAddItem(event) {
  event.preventDefault();
  const title = $('item-title').value.trim();
  
  if (!title) {
    showError('Destination title required');
    return;
  }
  
  setPending('add-item', true);
  try {
    await apiFetch('/api/items', {
      method: 'POST',
      body: JSON.stringify({ title })
    });
    $('item-title').value = '';
    await loadItems();
  } catch (err) {
    showError(`Failed to save destination: ${err.message}`);
  } finally {
    setPending('add-item', false);
  }
}

async function handleContact(event) {
  event.preventDefault();
  const name = $('contact-name').value.trim();
  const email = $('contact-email').value.trim();
  const message = $('contact-message').value.trim();
  
  if (!name || !email || !message) {
    elements.contactResult.textContent = 'All fields required';
    elements.contactResult.className = 'contact-result error';
    elements.contactResult.classList.remove('hidden');
    return;
  }
  
  if (!email.includes('@')) {
    elements.contactResult.textContent = 'Invalid email';
    elements.contactResult.className = 'contact-result error';
    elements.contactResult.classList.remove('hidden');
    return;
  }
  
  setPending('contact', true);
  try {
    const data = await apiFetch('/api/contact', {
      method: 'POST',
      body: JSON.stringify({ name, email, message })
    });
    
    if (data.status === 'captured') {
      elements.contactResult.textContent = 'Message captured in the test inbox. No email was sent.';
      elements.contactResult.className = 'contact-result success';
    } else if (data.status === 'accepted') {
      elements.contactResult.textContent = 'Your message was accepted by the email provider. Delivery is not yet confirmed.';
      elements.contactResult.className = 'contact-result success';
    } else {
      elements.contactResult.textContent = 'Message received but delivery status unknown.';
      elements.contactResult.className = 'contact-result error';
    }
    elements.contactResult.classList.remove('hidden');
    $('contact-name').value = '';
    $('contact-email').value = '';
    $('contact-message').value = '';
  } catch (err) {
    elements.contactResult.textContent = `Failed to send message: ${err.message}`;
    elements.contactResult.className = 'contact-result error';
    elements.contactResult.classList.remove('hidden');
  } finally {
    setPending('contact', false);
  }
}

async function handleLogout() {
  try {
    await apiFetch('/api/auth/logout', { method: 'POST' });
    state.user = null;
    state.trips = [];
    state.items = [];
    state.selectedTripId = null;
    state.tripDetail = null;
    elements.tripDetailSection.classList.add('hidden');
    await loadSession();
  } catch (err) {
    showError(`Failed to logout: ${err.message}`);
  }
}

function initEventListeners() {
  elements.createTripForm.addEventListener('submit', handleCreateTrip);
  elements.addItemForm.addEventListener('submit', handleAddItem);
  elements.contactForm.addEventListener('submit', handleContact);
  elements.logoutBtn.addEventListener('click', handleLogout);
}

async function init() {
  initElements();
  initEventListeners();
  showLoading();
  await loadSession();
}

init();
