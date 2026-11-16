/**
 * C++ WebAssembly To-Do Application Frontend Glue & UI Controller
 * Uses Emscripten Embind, IDBFS persistence queue, and standard C++ TaskManager
 */

let taskModule = null;
let taskManager = null;

// Calendar navigation state
let currentCalYear = new Date().getFullYear();
let currentCalMonth = new Date().getMonth() + 1; // 1-12
let selectedDateStr = getLocalTodayStr();
let currentFilter = 'all';

// IDBFS synchronization queue state
let isSyncing = false;
let hasPendingSync = false;

/**
 * Returns today's date formatted as YYYY-MM-DD in the user's local timezone
 */
function getLocalTodayStr() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Queued FS.syncfs(false) ensuring no overlapping syncs
 */
function queueSyncFS() {
    if (!taskModule || !taskModule.FS) return;

    if (isSyncing) {
        hasPendingSync = true;
        return;
    }

    isSyncing = true;
    taskModule.FS.syncfs(false, function (err) {
        isSyncing = false;
        if (err) {
            console.error('[Persistence] IDBFS sync error:', err);
        } else {
            console.log('[Persistence] IDBFS synced successfully to IndexedDB.');
        }

        if (hasPendingSync) {
            hasPendingSync = false;
            queueSyncFS();
        }
    });
}

/**
 * Shows transient notification banner
 */
function showNotification(message, type = 'error', durationMs = 4000) {
    const banner = document.getElementById('notificationBanner');
    banner.textContent = message;
    banner.className = `notification-banner ${type}`;
    banner.classList.remove('hidden');

    if (banner._timeoutId) {
        clearTimeout(banner._timeoutId);
    }
    banner._timeoutId = setTimeout(() => {
        banner.classList.add('hidden');
    }, durationMs);
}

/**
 * Initializes the WebAssembly Module and IDBFS filesystem
 */
async function initApp() {
    const overlay = document.getElementById('loadingOverlay');
    try {
        console.log('[WASM] Loading createTaskModule...');
        taskModule = await createTaskModule();

        // Setup Emscripten Virtual File System & mount IDBFS
        const dataDir = '/data';
        try {
            taskModule.FS.mkdir(dataDir);
        } catch (e) {
            // Already exists
        }

        taskModule.FS.mount(taskModule.IDBFS, {}, dataDir);

        // Step 1: Sync from IndexedDB into virtual memory before constructing TaskManager
        taskModule.FS.syncfs(true, function (err) {
            if (err) {
                console.error('[Persistence] Error syncing from IndexedDB on startup:', err);
            }

            console.log('[WASM] Constructing C++ TaskManager with /data/tasks.txt...');
            // Step 2: Construct TaskManager which calls load()
            taskManager = new taskModule.TaskManager('/data/tasks.txt');

            // Hook up window unload for RAII C++ destructor cleanup
            window.addEventListener('beforeunload', () => {
                if (taskManager) {
                    console.log('[WASM] Invoking ~TaskManager() via .delete()...');
                    taskManager.delete();
                    taskManager = null;
                }
            });

            // Hide loading overlay
            overlay.classList.add('fade-out');
            setTimeout(() => overlay.remove(), 400);

            // Step 3: Initial Display
            refreshUI();
            setupEventListeners();
        });

    } catch (err) {
        console.error('[WASM] Fatal error initializing engine:', err);
        overlay.innerHTML = `<p style="color: #ef4444; font-weight: 600;">Failed to load WebAssembly module: ${err.message}</p>`;
    }
}

/**
 * Refreshes all views from the C++ WASM engine
 */
function refreshUI() {
    if (!taskManager) return;

    const todayStr = getLocalTodayStr();

    // 1. Refresh Streak
    const streak = taskManager.getStreak(todayStr);
    document.getElementById('streakDisplay').textContent = streak;

    // 2. Refresh Daily Rate for Selected Date
    updateDailyRateDisplay(selectedDateStr);

    // 3. Refresh Task List
    renderTaskList();

    // 4. Refresh Calendar
    renderCalendar();

    // 5. Refresh Selected Day Details
    renderSelectedDayDetails();
}

/**
 * Updates Daily Rate card in header
 */
function updateDailyRateDisplay(dateStr) {
    const rate = taskManager.getDailyRate(dateStr);
    const displayEl = document.getElementById('dailyRateDisplay');
    const labelEl = document.getElementById('rateDateLabel');

    labelEl.textContent = (dateStr === getLocalTodayStr()) ? "Today's Rate" : `Rate (${dateStr})`;

    if (rate <= 0.0) {
        // As specified in PDF: When no task is due or completed on a day, show "No tasks"
        displayEl.textContent = "No tasks";
    } else {
        displayEl.textContent = `${rate.toFixed(1)}%`;
    }
}

/**
 * Renders tasks from getTasksJson()
 */
function renderTaskList() {
    const jsonStr = taskManager.getTasksJson();
    let tasks = [];
    try {
        tasks = JSON.parse(jsonStr);
    } catch (e) {
        console.error('Error parsing tasks JSON:', e);
    }

    const taskListEl = document.getElementById('taskList');
    const emptyState = document.getElementById('emptyListState');
    const totalCountEl = document.getElementById('totalTasksCount');

    totalCountEl.textContent = tasks.length;

    // Filter tasks
    const filteredTasks = tasks.filter(t => {
        if (currentFilter === 'pending') return !t.completed;
        if (currentFilter === 'completed') return t.completed;
        return true;
    });

    if (filteredTasks.length === 0) {
        taskListEl.innerHTML = '';
        emptyState.classList.remove('hidden');
        return;
    }

    emptyState.classList.add('hidden');
    const todayStr = getLocalTodayStr();

    taskListEl.innerHTML = filteredTasks.map(task => {
        const priorityLabels = ['Low', 'Medium', 'High'];
        const priorityClasses = ['priority-low', 'priority-med', 'priority-high'];
        const pLabel = priorityLabels[task.priority] || 'Low';
        const pClass = priorityClasses[task.priority] || 'priority-low';

        // Due date calculation
        let dueMarkup = '';
        if (task.dueDate) {
            let dueClass = '';
            let dueText = `📅 ${task.dueDate}`;
            if (!task.completed) {
                if (task.dueDate < todayStr) {
                    dueClass = 'overdue';
                    dueText = `⚠️ Overdue (${task.dueDate})`;
                } else if (task.dueDate === todayStr) {
                    dueClass = 'today';
                    dueText = `🎯 Due Today`;
                }
            }
            dueMarkup = `<span class="due-pill ${dueClass}">${dueText}</span>`;
        }

        let completedMarkup = '';
        if (task.completed && task.completedOn) {
            completedMarkup = `<span>✓ Completed on ${task.completedOn}</span>`;
        }

        return `
            <div class="task-item ${task.completed ? 'completed' : ''}" data-id="${task.id}">
                <div class="task-main">
                    <button class="checkbox-btn" onclick="handleToggleComplete(${task.id}, ${task.completed})" title="${task.completed ? 'Already completed' : 'Mark Complete'}">
                        ${task.completed ? '✓' : ''}
                    </button>
                    <div class="task-content">
                        <span class="task-desc">${escapeHtml(task.description)}</span>
                        <div class="task-meta">
                            <span class="priority-pill ${pClass}">${pLabel}</span>
                            ${dueMarkup}
                            ${completedMarkup}
                            <span>#${task.id}</span>
                        </div>
                    </div>
                </div>
                <div class="task-actions">
                    <button class="action-btn edit-btn" onclick="openEditModal(${task.id})" title="Edit Task">✏️</button>
                    <button class="action-btn delete-btn" onclick="handleDeleteTask(${task.id})" title="Delete Task">🗑️</button>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Renders the Calendar Month Grid using C++ getCalendar(year, month)
 */
function renderCalendar() {
    const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];
    document.getElementById('currentMonthYear').textContent = `${monthNames[currentCalMonth - 1]} ${currentCalYear}`;

    // Get C++ calendar summary array
    const calJson = taskManager.getCalendar(currentCalYear, currentCalMonth);
    let daysData = [];
    try {
        daysData = JSON.parse(calJson);
    } catch (e) {
        console.error('Error parsing calendar JSON:', e);
    }

    const gridEl = document.getElementById('calendarDaysGrid');
    gridEl.innerHTML = '';

    // Calculate weekday offset for the 1st of the month
    const firstDayWeekday = new Date(currentCalYear, currentCalMonth - 1, 1).getDay();

    // Render leading empty cells
    for (let i = 0; i < firstDayWeekday; ++i) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'calendar-day empty';
        gridEl.appendChild(emptyCell);
    }

    const todayStr = getLocalTodayStr();

    // Render calendar days
    daysData.forEach(dayInfo => {
        const dayCell = document.createElement('div');
        dayCell.className = 'calendar-day';
        if (dayInfo.date === todayStr) {
            dayCell.classList.add('today');
        }
        if (dayInfo.date === selectedDateStr) {
            dayCell.classList.add('selected');
        }

        let dotsHtml = '';
        if (dayInfo.due > 0 && dayInfo.completed > 0) {
            dotsHtml = `<div class="day-dots"><span class="dot dot-both" title="Due & Completed"></span></div>`;
        } else if (dayInfo.due > 0) {
            dotsHtml = `<div class="day-dots"><span class="dot dot-due" title="Due: ${dayInfo.due}"></span></div>`;
        } else if (dayInfo.completed > 0) {
            dotsHtml = `<div class="day-dots"><span class="dot dot-completed" title="Completed: ${dayInfo.completed}"></span></div>`;
        } else {
            dotsHtml = `<div class="day-dots"></div>`;
        }

        dayCell.innerHTML = `
            <span>${dayInfo.day}</span>
            ${dotsHtml}
        `;

        dayCell.addEventListener('click', () => {
            selectedDateStr = dayInfo.date;
            refreshUI();
        });

        gridEl.appendChild(dayCell);
    });
}

/**
 * Renders detailed statistics and task list for the selected day
 */
function renderSelectedDayDetails() {
    document.getElementById('selectedDateBadge').textContent = selectedDateStr;

    // Get tasks from C++ engine
    const jsonStr = taskManager.getTasksJson();
    let tasks = [];
    try {
        tasks = JSON.parse(jsonStr);
    } catch (e) {}

    let dueCount = 0;
    let completedCount = 0;
    const dayTasks = [];

    tasks.forEach(t => {
        const isDue = (t.dueDate === selectedDateStr);
        const isCompleted = (t.completed && t.completedOn === selectedDateStr);

        if (isDue) dueCount++;
        if (isCompleted) completedCount++;

        if (isDue || isCompleted) {
            dayTasks.push({ ...t, isDueOnDay: isDue, isCompletedOnDay: isCompleted });
        }
    });

    document.getElementById('dayDueCount').textContent = dueCount;
    document.getElementById('dayCompletedCount').textContent = completedCount;
    document.getElementById('dayDistinctCount').textContent = dayTasks.length;

    // Daily Completion Rate
    const rate = taskManager.getDailyRate(selectedDateStr);
    const rateTextEl = document.getElementById('dayRateText');
    const progressBar = document.getElementById('dayProgressBar');

    if (dayTasks.length === 0) {
        rateTextEl.textContent = "No tasks";
        progressBar.style.width = "0%";
    } else {
        rateTextEl.textContent = `${rate.toFixed(1)}%`;
        progressBar.style.width = `${Math.min(100, Math.max(0, rate))}%`;
    }

    // List of tasks for this day
    const dayTasksList = document.getElementById('dayTasksList');
    if (dayTasks.length === 0) {
        dayTasksList.innerHTML = `<li style="color: var(--text-muted); font-size: 0.8rem; text-align: center; padding: 0.5rem;">No tasks due or completed on this day.</li>`;
    } else {
        dayTasksList.innerHTML = dayTasks.map(t => {
            let tags = [];
            if (t.isDueOnDay) tags.push('<span style="color: #3b82f6;">Due</span>');
            if (t.isCompletedOnDay) tags.push('<span style="color: #10b981;">Done</span>');

            return `
                <li class="day-task-item ${t.completed ? 'is-done' : ''}">
                    <span>${escapeHtml(t.description)}</span>
                    <span style="font-size: 0.7rem; font-weight: 600;">${tags.join(' | ')}</span>
                </li>
            `;
        }).join('');
    }
}

/**
 * Handles adding a task through C++ addTask()
 */
function handleAddTask(e) {
    e.preventDefault();
    const descInput = document.getElementById('taskDesc');
    const prioInput = document.getElementById('taskPriority');
    const dueInput = document.getElementById('taskDueDate');

    const desc = descInput.value.trim();
    const prio = parseInt(prioInput.value, 10);
    const due = dueInput.value.trim();

    if (!desc) {
        showNotification('Task description cannot be empty.', 'error');
        return;
    }

    // Call WASM engine
    const success = taskManager.addTask(desc, prio, due);
    if (!success) {
        showNotification('Failed to add task. Please verify date format or leap year validity.', 'error');
        return;
    }

    // Queue storage sync
    queueSyncFS();

    // Reset form
    descInput.value = '';
    dueInput.value = '';
    prioInput.value = '1';

    showNotification('Task added successfully!', 'success', 2500);
    refreshUI();
}

/**
 * Handles marking a task complete through C++ markComplete(id, today)
 */
function handleToggleComplete(id, isAlreadyCompleted) {
    if (isAlreadyCompleted) {
        showNotification('Task is already completed. Re-completing is not permitted to preserve streaks.', 'error');
        return;
    }

    const todayStr = getLocalTodayStr();
    const success = taskManager.markComplete(id, todayStr);
    if (!success) {
        showNotification('Failed to complete task. ID not found or already completed.', 'error');
        return;
    }

    queueSyncFS();
    showNotification('Task completed! Streak updated.', 'success', 2500);
    refreshUI();
}

/**
 * Handles deleting a task through C++ deleteTask(id)
 */
function handleDeleteTask(id) {
    if (!confirm(`Are you sure you want to delete task #${id}?`)) {
        return;
    }

    const success = taskManager.deleteTask(id);
    if (!success) {
        showNotification('Failed to delete task. ID not found.', 'error');
        return;
    }

    queueSyncFS();
    showNotification(`Task #${id} deleted.`, 'success', 2500);
    refreshUI();
}

/**
 * Opens edit modal
 */
function openEditModal(id) {
    const jsonStr = taskManager.getTasksJson();
    let tasks = [];
    try { tasks = JSON.parse(jsonStr); } catch (e) {}

    const task = tasks.find(t => t.id === id);
    if (!task) return;

    document.getElementById('editTaskId').value = task.id;
    document.getElementById('editTaskDesc').value = task.description;
    document.getElementById('editTaskPriority').value = task.priority;
    document.getElementById('editTaskDueDate').value = task.dueDate || '';

    document.getElementById('editTaskModal').classList.remove('hidden');
}

/**
 * Closes edit modal
 */
function closeEditModal() {
    document.getElementById('editTaskModal').classList.add('hidden');
}

/**
 * Handles submitting edit form via C++ updateTask()
 */
function handleSaveEdit(e) {
    e.preventDefault();
    const id = parseInt(document.getElementById('editTaskId').value, 10);
    const desc = document.getElementById('editTaskDesc').value.trim();
    const prio = parseInt(document.getElementById('editTaskPriority').value, 10);
    const due = document.getElementById('editTaskDueDate').value.trim();

    if (!desc) {
        showNotification('Description cannot be empty.', 'error');
        return;
    }

    const success = taskManager.updateTask(id, desc, prio, due);
    if (!success) {
        showNotification('Failed to update task. Please verify date format or leap year validity.', 'error');
        return;
    }

    queueSyncFS();
    closeEditModal();
    showNotification(`Task #${id} updated successfully.`, 'success', 2500);
    refreshUI();
}

/**
 * Event Listeners Setup
 */
function setupEventListeners() {
    // Add task form
    document.getElementById('addTaskForm').addEventListener('submit', handleAddTask);

    // Edit modal
    document.getElementById('editTaskForm').addEventListener('submit', handleSaveEdit);
    document.getElementById('btnCancelEdit').addEventListener('click', closeEditModal);
    document.getElementById('btnCancelEdit2').addEventListener('click', closeEditModal);

    // Filter buttons
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentFilter = btn.dataset.filter;
            renderTaskList();
        });
    });

    // Calendar navigation
    document.getElementById('prevMonthBtn').addEventListener('click', () => {
        currentCalMonth--;
        if (currentCalMonth < 1) {
            currentCalMonth = 12;
            currentCalYear--;
        }
        renderCalendar();
    });

    document.getElementById('nextMonthBtn').addEventListener('click', () => {
        currentCalMonth++;
        if (currentCalMonth > 12) {
            currentCalMonth = 1;
            currentCalYear++;
        }
        renderCalendar();
    });

    document.getElementById('todayMonthBtn').addEventListener('click', () => {
        const d = new Date();
        currentCalYear = d.getFullYear();
        currentCalMonth = d.getMonth() + 1;
        selectedDateStr = getLocalTodayStr();
        refreshUI();
    });
}

/**
 * Utility to escape HTML to prevent XSS
 */
function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Start application when DOM is ready
window.addEventListener('DOMContentLoaded', initApp);
