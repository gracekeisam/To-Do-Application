/**
 * To-Do List Application — C++ WebAssembly To-Do & Goal Calendar Frontend Glue
 * Connects the responsive Apple-HIG-aligned UI to the Emscripten Embind C++ TaskManager
 * with queued IDBFS persistence and RAII cleanup on unload.
 */

let taskModule = null;
let taskManager = null;

// UI state
let currentCalYear = new Date().getFullYear();
let currentCalMonth = new Date().getMonth() + 1; // 1-12
let selectedDateStr = getLocalTodayStr();
let currentFilter = 'all';
let pendingDeleteId = null;
let lastFocusedBeforeModal = null;

// IDBFS synchronization queue state
let isSyncing = false;
let hasPendingSync = false;

const RATE_RING_CIRCUMFERENCE = 2 * Math.PI * 7.5; // r = 7.5 => 47.123889...

/**
 * Returns today's local date as YYYY-MM-DD (avoids UTC timezone drift)
 */
function getLocalTodayStr() {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/**
 * Formats YYYY-MM-DD into a human-friendly short date label
 */
function formatReadableDate(dateStr, includeTodayPrefix = false) {
    if (!dateStr || dateStr.length !== 10) return dateStr || '';
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    const shortFmt = dt.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
    });
    if (includeTodayPrefix && dateStr === getLocalTodayStr()) {
        return `Today · ${dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    }
    return shortFmt;
}

/**
 * Queued FS.syncfs(false) so overlapping Emscripten IDBFS writes never collide
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
        }

        if (hasPendingSync) {
            hasPendingSync = false;
            queueSyncFS();
        }
    });
}

/**
 * Shows a polite dismissible status toast
 */
function showStatusToast(message, isError = false) {
    const toast = document.getElementById('statusToast');
    const msgEl = document.getElementById('statusToastMessage');
    if (!toast || !msgEl) return;

    msgEl.textContent = message;
    toast.classList.toggle('is-error', isError);
    toast.classList.remove('hidden');

    if (toast._timerId) {
        clearTimeout(toast._timerId);
        toast._timerId = null;
    }

    // Keep errors visible until dismissed (Apple HIG Cognitive guidance); gentle auto-hide for routine confirmations
    if (!isError) {
        toast._timerId = setTimeout(() => {
            toast.classList.add('hidden');
        }, 4500);
    }
}

function hideStatusToast() {
    const toast = document.getElementById('statusToast');
    if (!toast) return;
    if (toast._timerId) {
        clearTimeout(toast._timerId);
        toast._timerId = null;
    }
    toast.classList.add('hidden');
}

/**
 * Inline field validation helper
 */
function setFieldError(elementId, message) {
    const el = document.getElementById(elementId);
    if (!el) return;
    if (message) {
        el.textContent = message;
        el.classList.remove('hidden');
    } else {
        el.textContent = '';
        el.classList.add('hidden');
    }
}

/**
 * Initializes the C++ WebAssembly module and IDBFS storage
 */
async function initApp() {
    const loadingBar = document.getElementById('loadingBanner');
    try {
        taskModule = await createTaskModule();

        const dataDir = '/data';
        if (taskModule.FS) {
            try {
                taskModule.FS.mkdir(dataDir);
            } catch (e) {
                // Already exists
            }
        }

        const idbfsDriver =
            taskModule.IDBFS ||
            (taskModule.FS && taskModule.FS.filesystems && taskModule.FS.filesystems.IDBFS);

        const startEngine = () => {
            const storagePath = taskModule.FS ? '/data/tasks.txt' : 'tasks.txt';
            taskManager = new taskModule.TaskManager(storagePath);

            // RAII destructor cleanup on page unload
            window.addEventListener('beforeunload', () => {
                if (taskManager) {
                    taskManager.delete();
                    taskManager = null;
                }
            });

            if (loadingBar) {
                loadingBar.classList.add('is-ready');
                setTimeout(() => loadingBar.remove(), 260);
            }

            setupEventListeners();
            refreshUI();
        };

        if (idbfsDriver && taskModule.FS) {
            try {
                taskModule.FS.mount(idbfsDriver, {}, dataDir);
                taskModule.FS.syncfs(true, function (err) {
                    if (err) {
                        console.warn('[Persistence] Initial sync warning:', err);
                    }
                    startEngine();
                });
            } catch (mountErr) {
                console.warn('[Persistence] IDBFS mount fallback to MEMFS:', mountErr);
                startEngine();
            }
        } else {
            startEngine();
        }
    } catch (err) {
        console.error('[WASM] Fatal error initializing engine:', err);
        if (loadingBar) {
            loadingBar.classList.add('is-error');
            loadingBar.textContent = `Unable to load the task engine: ${err.message}`;
        }
    }
}

/**
 * Safely parses task array from C++ getTasksJson()
 */
function fetchTasksFromEngine() {
    if (!taskManager) return [];
    try {
        return JSON.parse(taskManager.getTasksJson());
    } catch (e) {
        console.error('[WASM] Error parsing tasks JSON:', e);
        return [];
    }
}

/**
 * Refreshes every view directly from the C++ WASM engine
 */
function refreshUI() {
    if (!taskManager) return;

    const todayStr = getLocalTodayStr();
    const tasks = fetchTasksFromEngine();

    // 1. Streak from C++ engine
    const streak = taskManager.getStreak(todayStr);
    document.getElementById('streakDisplay').textContent = streak;
    document.getElementById('streakUnit').textContent = streak === 1 ? 'day streak' : 'day streak';

    // 2. Daily completion rate in top bar
    updateHeaderRateDisplay(selectedDateStr, tasks);

    // 3. Task list & filter counts
    renderTaskList(tasks);

    // 4. Signature Calendar from C++ getCalendar()
    const daysData = renderCalendar();

    // 5. Selected Day Inspector
    renderSelectedDayDetails(tasks, daysData);

    // 6. Keep the sliding pastel navigator pill aligned with active tab width/position
    requestAnimationFrame(syncFilterIndicator);
}

/**
 * Aligns the smooth sliding pastel pill inside the All / Pending / Done navigator
 */
function syncFilterIndicator() {
    const nav = document.getElementById('filterNav');
    const indicator = document.getElementById('segmentIndicator');
    if (!nav || !indicator) return;

    const activeBtn = nav.querySelector('.segment-btn.active');
    if (!activeBtn) return;

    nav.dataset.active = currentFilter;
    indicator.style.width = `${activeBtn.offsetWidth}px`;
    indicator.style.transform = `translateX(${activeBtn.offsetLeft}px)`;
}

/**
 * Updates top bar daily rate metric and miniature SVG progress ring
 */
function updateHeaderRateDisplay(dateStr, tasks) {
    const rate = taskManager.getDailyRate(dateStr);
    const displayEl = document.getElementById('dailyRateDisplay');
    const labelEl = document.getElementById('rateDateLabel');
    const ringEl = document.getElementById('headerRateRing');

    const hasTasksOnDay = tasks.some(
        t => t.dueDate === dateStr || (t.completed && t.completedOn === dateStr)
    );

    labelEl.textContent = dateStr === getLocalTodayStr() ? 'today' : formatReadableDate(dateStr);

    if (!hasTasksOnDay) {
        displayEl.textContent = 'No tasks';
        if (ringEl) {
            ringEl.style.strokeDashoffset = String(RATE_RING_CIRCUMFERENCE);
        }
    } else {
        displayEl.textContent = `${rate.toFixed(1)}%`;
        if (ringEl) {
            const clamped = Math.max(0, Math.min(100, rate));
            const offset = RATE_RING_CIRCUMFERENCE * (1 - clamped / 100);
            ringEl.style.strokeDashoffset = String(offset);
        }
    }
}

/**
 * Renders the grouped task list and segmented filter counts
 */
function renderTaskList(tasks) {
    const totalCount = tasks.length;
    const completedCount = tasks.filter(t => t.completed).length;
    const pendingCount = totalCount - completedCount;

    document.getElementById('countAll').textContent = totalCount;
    document.getElementById('countPending').textContent = pendingCount;
    document.getElementById('countCompleted').textContent = completedCount;
    document.getElementById('tasksSummarySubtitle').textContent =
        pendingCount === 1 ? '1 pending' : `${pendingCount} pending`;

    const filteredTasks = tasks.filter(t => {
        if (currentFilter === 'pending') return !t.completed;
        if (currentFilter === 'completed') return t.completed;
        return true;
    });

    const taskListEl = document.getElementById('taskList');
    const emptyState = document.getElementById('emptyListState');
    const emptyTitle = document.getElementById('emptyStateTitle');
    const emptyDesc = document.getElementById('emptyStateDesc');
    const resetBtn = document.getElementById('btnEmptyResetFilter');

    if (filteredTasks.length === 0) {
        taskListEl.innerHTML = '';
        emptyState.classList.remove('hidden');

        if (totalCount === 0) {
            emptyTitle.textContent = 'No tasks yet';
            emptyDesc.textContent = 'Add a task above with an optional due date to track your daily completion rate.';
            resetBtn.classList.add('hidden');
        } else if (currentFilter === 'pending') {
            emptyTitle.textContent = 'All caught up';
            emptyDesc.textContent = 'Every task is complete. Add another task above or review completed items.';
            resetBtn.classList.remove('hidden');
        } else {
            emptyTitle.textContent = 'No completed tasks yet';
            emptyDesc.textContent = 'Check off a pending task to record your progress and build your streak.';
            resetBtn.classList.remove('hidden');
        }
        return;
    }

    emptyState.classList.add('hidden');
    const todayStr = getLocalTodayStr();

    const priorityLabels = ['Low', 'Medium', 'High'];
    const priorityClasses = ['priority-low', 'priority-med', 'priority-high'];

    taskListEl.innerHTML = filteredTasks
        .map(task => {
            const pLabel = priorityLabels[task.priority] || 'Low';
            const pClass = priorityClasses[task.priority] || 'priority-low';

            let dueMarkup = '';
            if (task.dueDate) {
                let dueClass = '';
                let dueText = `Due ${formatReadableDate(task.dueDate)}`;
                if (!task.completed) {
                    if (task.dueDate < todayStr) {
                        dueClass = 'is-overdue';
                        dueText = `Overdue · ${formatReadableDate(task.dueDate)}`;
                    } else if (task.dueDate === todayStr) {
                        dueClass = 'is-today';
                        dueText = 'Due today';
                    }
                }
                dueMarkup = `<span class="due-label ${dueClass}">${escapeHtml(dueText)}</span>`;
            }

            let completedMarkup = '';
            if (task.completed && task.completedOn) {
                completedMarkup = `<span>Completed ${escapeHtml(formatReadableDate(task.completedOn))}</span>`;
            }

            const checkIcon = task.completed
                ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>`
                : '';

            const isConfirmingDelete = pendingDeleteId === task.id;
            const actionsMarkup = isConfirmingDelete
                ? `
                    <div class="confirm-delete-group" role="group" aria-label="Confirm delete task">
                        <button type="button" class="btn btn-secondary btn-compact" data-action="cancel-delete" data-id="${task.id}">Cancel</button>
                        <button type="button" class="btn btn-destructive btn-compact" data-action="confirm-delete" data-id="${task.id}">Delete</button>
                    </div>
                `
                : `
                    <button type="button" class="icon-btn" data-action="edit" data-id="${task.id}" aria-label="Edit task: ${escapeHtml(task.description)}" title="Edit task">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M12 20h9"/>
                            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>
                        </svg>
                    </button>
                    <button type="button" class="icon-btn icon-btn-danger" data-action="request-delete" data-id="${task.id}" aria-label="Delete task: ${escapeHtml(task.description)}" title="Delete task">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M3 6h18"/>
                            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                        </svg>
                    </button>
                `;

            return `
                <div class="task-row ${task.completed ? 'is-completed' : ''}" role="listitem" data-id="${task.id}">
                    <div class="task-row-main">
                        <button
                            type="button"
                            class="check-target"
                            data-action="complete"
                            data-id="${task.id}"
                            data-completed="${task.completed ? '1' : '0'}"
                            aria-label="${task.completed ? `Completed: ${escapeHtml(task.description)}` : `Mark complete: ${escapeHtml(task.description)}`}"
                            aria-pressed="${task.completed ? 'true' : 'false'}"
                            title="${task.completed ? 'Already completed' : 'Mark complete'}"
                        >
                            <span class="check-circle">${checkIcon}</span>
                        </button>

                        <div class="task-body">
                            <span class="task-desc">${escapeHtml(task.description)}</span>
                            <div class="task-meta">
                                <span class="priority-tag ${pClass}">
                                    <span class="priority-dot" aria-hidden="true"></span>
                                    ${pLabel}
                                </span>
                                ${dueMarkup}
                                ${completedMarkup}
                            </div>
                        </div>
                    </div>

                    <div class="task-actions">
                        ${actionsMarkup}
                    </div>
                </div>
            `;
        })
        .join('');
}

/**
 * Renders the Monthly Goal Calendar using C++ getCalendar(year, month)
 * Applies C++-computed light & dark CSS custom properties per bubble.
 */
function renderCalendar() {
    const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    document.getElementById('currentMonthYear').textContent =
        `${monthNames[currentCalMonth - 1]} ${currentCalYear}`;

    let daysData = [];
    try {
        daysData = JSON.parse(taskManager.getCalendar(currentCalYear, currentCalMonth));
    } catch (e) {
        console.error('[WASM] Error parsing calendar JSON:', e);
    }

    const gridEl = document.getElementById('calendarDaysGrid');
    gridEl.innerHTML = '';

    const firstDayWeekday = new Date(currentCalYear, currentCalMonth - 1, 1).getDay();
    for (let i = 0; i < firstDayWeekday; ++i) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'calendar-day empty';
        emptyCell.setAttribute('aria-hidden', 'true');
        gridEl.appendChild(emptyCell);
    }

    const todayStr = getLocalTodayStr();

    daysData.forEach(dayInfo => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'calendar-day';

        if (dayInfo.hasTasks) {
            btn.classList.add('has-goal', `tier-${dayInfo.tier}`);
            btn.style.setProperty('--goal-bg', dayInfo.bgColor);
            btn.style.setProperty('--goal-border', dayInfo.borderColor);
            btn.style.setProperty('--goal-text', dayInfo.textColor);
            btn.style.setProperty('--goal-bg-dark', dayInfo.darkBgColor);
            btn.style.setProperty('--goal-border-dark', dayInfo.darkBorderColor);
            btn.style.setProperty('--goal-text-dark', dayInfo.darkTextColor);

            const label = `${formatReadableDate(dayInfo.date)}: ${dayInfo.completed} of ${dayInfo.distinct} tasks completed, ${dayInfo.rate.toFixed(1)}%`;
            btn.setAttribute('aria-label', label);
            btn.title = `${dayInfo.date} — ${dayInfo.completed}/${dayInfo.distinct} goal met (${dayInfo.rate.toFixed(1)}%)`;
        } else {
            btn.setAttribute('aria-label', `${formatReadableDate(dayInfo.date)}: No tasks`);
            btn.title = `${dayInfo.date} — No tasks`;
        }

        if (dayInfo.date === todayStr) {
            btn.classList.add('today');
        }

        const isSelected = dayInfo.date === selectedDateStr;
        if (isSelected) {
            btn.classList.add('selected');
        }
        btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');

        const rateHtml = dayInfo.hasTasks
            ? `<span class="day-rate">${escapeHtml(dayInfo.rateLabel)}</span>`
            : '';

        btn.innerHTML = `
            <span class="day-number">${dayInfo.day}</span>
            ${rateHtml}
        `;

        btn.addEventListener('click', () => {
            selectedDateStr = dayInfo.date;
            refreshUI();
        });

        gridEl.appendChild(btn);
    });

    return daysData;
}

/**
 * Renders the integrated Selected Day Inspector below the calendar
 */
function renderSelectedDayDetails(tasks, daysData) {
    document.getElementById('selectedDateHeading').textContent =
        formatReadableDate(selectedDateStr, true);

    let dueCount = 0;
    let completedCount = 0;
    const dayTasks = [];

    tasks.forEach(t => {
        const isDue = t.dueDate === selectedDateStr;
        const isCompleted = t.completed && t.completedOn === selectedDateStr;
        if (isDue) dueCount++;
        if (isCompleted) completedCount++;
        if (isDue || isCompleted) {
            dayTasks.push({ ...t, isDueOnDay: isDue, isCompletedOnDay: isCompleted });
        }
    });

    document.getElementById('dayMetaSummary').textContent =
        `${completedCount} completed · ${dueCount} due · ${dayTasks.length} distinct`;

    const rate = taskManager.getDailyRate(selectedDateStr);
    const rateTextEl = document.getElementById('dayRateText');
    const progressBar = document.getElementById('dayProgressBar');
    const progressTrack = document.getElementById('dayProgressTrack');

    if (dayTasks.length === 0) {
        rateTextEl.textContent = 'No tasks';
        progressBar.style.width = '0%';
        progressBar.style.backgroundColor = 'var(--surface-secondary)';
        progressTrack.setAttribute('aria-valuenow', '0');
    } else {
        const pct = Math.min(100, Math.max(0, rate));
        rateTextEl.textContent = `${rate.toFixed(1)}%`;
        progressBar.style.width = `${pct}%`;
        progressTrack.setAttribute('aria-valuenow', String(Math.round(pct)));

        // Match progress fill color to C++ goal tier
        const matchedDay = Array.isArray(daysData)
            ? daysData.find(d => d.date === selectedDateStr)
            : null;
        if (matchedDay && matchedDay.hasTasks) {
            progressBar.style.backgroundColor =
                matchedDay.tier === 'full' ? 'var(--signal-success)' : matchedDay.borderColor;
        } else {
            progressBar.style.backgroundColor = 'var(--signal-success)';
        }
    }

    const dayTasksList = document.getElementById('dayTasksList');
    if (dayTasks.length === 0) {
        dayTasksList.innerHTML = `<li class="day-tasks-empty">No tasks due or completed on this day.</li>`;
    } else {
        dayTasksList.innerHTML = dayTasks
            .map(t => {
                const badges = [];
                if (t.isDueOnDay) badges.push('<span class="tag-due">Due</span>');
                if (t.isCompletedOnDay) badges.push('<span class="tag-done">Done</span>');

                return `
                    <li class="day-task-item ${t.completed ? 'is-done' : ''}">
                        <span class="day-task-title">${escapeHtml(t.description)}</span>
                        <span class="day-task-badges">${badges.join('')}</span>
                    </li>
                `;
            })
            .join('');
    }
}

/**
 * Adds a task via C++ addTask()
 */
function handleAddTask(e) {
    e.preventDefault();
    setFieldError('taskFormError', '');

    const descInput = document.getElementById('taskDesc');
    const dueInput = document.getElementById('taskDueDate');
    const prioChecked = document.querySelector('input[name="taskPriority"]:checked');

    const desc = descInput.value.trim();
    const prio = prioChecked ? parseInt(prioChecked.value, 10) : 1;
    const due = dueInput.value.trim();

    if (!desc) {
        setFieldError('taskFormError', 'Enter a task description before adding.');
        descInput.focus();
        return;
    }

    const success = taskManager.addTask(desc, prio, due);
    if (!success) {
        setFieldError('taskFormError', 'Check the due date — enter a valid calendar date (YYYY-MM-DD).');
        dueInput.focus();
        return;
    }

    queueSyncFS();

    descInput.value = '';
    dueInput.value = '';
    const defaultPrio = document.querySelector('input[name="taskPriority"][value="1"]');
    if (defaultPrio) defaultPrio.checked = true;

    pendingDeleteId = null;
    refreshUI();
    descInput.focus();
}

/**
 * Marks a task complete via C++ markComplete(id, today)
 */
function handleCompleteTask(id, isAlreadyCompleted) {
    if (isAlreadyCompleted) {
        showStatusToast('Completed tasks stay locked so past streaks stay accurate.', false);
        return;
    }

    const todayStr = getLocalTodayStr();
    const success = taskManager.markComplete(id, todayStr);
    if (!success) {
        showStatusToast('Unable to complete that task. Try refreshing the list.', true);
        return;
    }

    pendingDeleteId = null;
    queueSyncFS();
    refreshUI();
}

/**
 * Deletes a task via C++ deleteTask(id)
 */
function handleConfirmDelete(id) {
    const success = taskManager.deleteTask(id);
    if (!success) {
        showStatusToast('Unable to delete that task.', true);
        return;
    }

    pendingDeleteId = null;
    queueSyncFS();
    refreshUI();
    showStatusToast('Task deleted.');
}

/**
 * Opens accessible Edit Sheet
 */
function openEditModal(id, triggerEl) {
    const tasks = fetchTasksFromEngine();
    const task = tasks.find(t => t.id === id);
    if (!task) return;

    lastFocusedBeforeModal = triggerEl || document.activeElement;
    setFieldError('editFormError', '');

    document.getElementById('editTaskId').value = task.id;
    document.getElementById('editTaskDesc').value = task.description;
    document.getElementById('editTaskDueDate').value = task.dueDate || '';

    const prioRadio = document.querySelector(
        `input[name="editTaskPriority"][value="${task.priority}"]`
    );
    if (prioRadio) prioRadio.checked = true;

    const modal = document.getElementById('editTaskModal');
    modal.classList.remove('hidden');
    document.getElementById('editTaskDesc').focus();
}

/**
 * Closes Edit Sheet and restores keyboard focus
 */
function closeEditModal() {
    const modal = document.getElementById('editTaskModal');
    modal.classList.add('hidden');
    setFieldError('editFormError', '');

    if (lastFocusedBeforeModal && typeof lastFocusedBeforeModal.focus === 'function') {
        lastFocusedBeforeModal.focus();
    }
    lastFocusedBeforeModal = null;
}

/**
 * Saves task changes via C++ updateTask()
 */
function handleSaveEdit(e) {
    e.preventDefault();
    setFieldError('editFormError', '');

    const id = parseInt(document.getElementById('editTaskId').value, 10);
    const descInput = document.getElementById('editTaskDesc');
    const dueInput = document.getElementById('editTaskDueDate');
    const prioChecked = document.querySelector('input[name="editTaskPriority"]:checked');

    const desc = descInput.value.trim();
    const prio = prioChecked ? parseInt(prioChecked.value, 10) : 1;
    const due = dueInput.value.trim();

    if (!desc) {
        setFieldError('editFormError', 'Enter a task description to save changes.');
        descInput.focus();
        return;
    }

    const success = taskManager.updateTask(id, desc, prio, due);
    if (!success) {
        setFieldError('editFormError', 'Check the due date — enter a valid calendar date (YYYY-MM-DD).');
        dueInput.focus();
        return;
    }

    queueSyncFS();
    closeEditModal();
    refreshUI();
    showStatusToast('Changes saved.');
}

/**
 * Sets up all event listeners (delegated task actions, forms, keyboard shortcuts)
 */
function setupEventListeners() {
    // Composer submit & clear validation error on input
    document.getElementById('addTaskForm').addEventListener('submit', handleAddTask);
    document.getElementById('taskDesc').addEventListener('input', () => setFieldError('taskFormError', ''));
    document.getElementById('taskDueDate').addEventListener('change', () => setFieldError('taskFormError', ''));

    // Edit Sheet submit, dismiss, Escape key & backdrop click
    document.getElementById('editTaskForm').addEventListener('submit', handleSaveEdit);
    document.getElementById('editTaskDesc').addEventListener('input', () => setFieldError('editFormError', ''));
    document.getElementById('btnCancelEdit').addEventListener('click', closeEditModal);
    document.getElementById('btnCancelEdit2').addEventListener('click', closeEditModal);

    const modalEl = document.getElementById('editTaskModal');
    modalEl.addEventListener('click', e => {
        if (e.target === modalEl) closeEditModal();
    });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && !modalEl.classList.contains('hidden')) {
            closeEditModal();
        }
    });

    // Toast dismiss
    document.getElementById('btnDismissToast').addEventListener('click', hideStatusToast);

    // Delegated Task Row Actions
    document.getElementById('taskList').addEventListener('click', e => {
        const btn = e.target.closest('button[data-action]');
        if (!btn) return;

        const action = btn.dataset.action;
        const id = parseInt(btn.dataset.id, 10);

        if (action === 'complete') {
            handleCompleteTask(id, btn.dataset.completed === '1');
        } else if (action === 'edit') {
            openEditModal(id, btn);
        } else if (action === 'request-delete') {
            pendingDeleteId = id;
            refreshUI();
        } else if (action === 'cancel-delete') {
            pendingDeleteId = null;
            refreshUI();
        } else if (action === 'confirm-delete') {
            handleConfirmDelete(id);
        }
    });

    // Filter Segmented Control (with sliding pastel indicator)
    document.querySelectorAll('.segment-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.segment-btn').forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');
            currentFilter = btn.dataset.filter;
            pendingDeleteId = null;
            syncFilterIndicator();
            refreshUI();
        });
    });

    window.addEventListener('resize', syncFilterIndicator);

    // Empty state filter reset button
    document.getElementById('btnEmptyResetFilter').addEventListener('click', () => {
        const allTab = document.querySelector('.segment-btn[data-filter="all"]');
        if (allTab) allTab.click();
    });

    // Calendar Navigation
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
 * Escapes HTML entities to prevent XSS
 */
function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

window.addEventListener('DOMContentLoaded', initApp);
