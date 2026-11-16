# C++ To-Do List Application on the Web with WebAssembly

> A browser-based task management and habit tracking web application whose core logic is written in modern C++ and compiled to WebAssembly (WASM), featuring an interactive month calendar, leap-year date validation, daily completion rate analytics, and a consistency streak counter.

---

## 🌟 Overview & Architecture

This application brings standard C++ object-oriented architecture directly to the browser at near-native execution speed. The web interface never mutates task data directly; every operation passes through the compiled WebAssembly engine.

```
                      +-----------------------------+
                      |    Vercel (Static Web)      |
                      +--------------+--------------+
                                     |
                          [HTML, CSS, JS, WASM]
                                     v
                  +------------------------------------+
                  |       User's Web Browser           |
                  |                                    |
                  |  +------------------------------+  |
                  |  |      Responsive Web UI       |  |
                  |  +--------------+---------------+  |
                  |                 |                  |
                  |                 v                  |
                  |  +------------------------------+  |
                  |  |    JavaScript Embind Glue    |  |
                  |  +--------------+---------------+  |
                  |                 |                  |
                  |                 v                  |
                  |  +------------------------------+  |
                  |  |   C++ Task Engine (WASM)     |  |
                  |  |   - Task & TaskManager       |  |
                  |  |   - DateUtils (Leap-year)    |  |
                  |  |   - Analytics & Streaks      |  |
                  |  +--------------+---------------+  |
                  |                 |                  |
                  |                 v                  |
                  |  +------------------------------+  |
                  |  |   IDBFS Virtual Filesystem   |  |
                  |  |   (tasks.txt.tmp -> tasks.txt) |
                  |  +--------------+---------------+  |
                  |                 |                  |
                  |                 v                  |
                  |  +------------------------------+  |
                  |  |     IndexedDB (Storage)      |  |
                  |  +------------------------------+  |
                  +------------------------------------+
```

---

## 🚀 Key Features

1. **Pure C++ Task Engine (`Task`, `TaskManager`, `Priority`)**:
   - Manages tasks in a `std::vector<Task>` dynamically allocated in WASM linear memory.
   - Enforces the **Rule of Zero** (no manual `new` or `delete`; automatic memory management through standard C++ containers and RAII).
   - Strict input sanitization: automatically converts pipe characters (`|`) to `/` and normalizes line breaks (`\r`, `\n`) to preserve single-line delimited integrity.

2. **Leap-Year-Aware Date Handling (`DateUtils`)**:
   - Custom calendar algorithms accurately handle standard months, 28/29-day February in leap years, month transitions (e.g. stepping back from 1 March to 29 Feb in leap years), and year transitions (stepping back from 1 January to 31 December of previous year).

3. **Daily Completion Rate Calculation**:
   - Computed within the C++ engine:
     $$\text{Daily Completion Rate} = \frac{\text{Completed on Date}}{\text{Distinct Task IDs (Due on Date or Completed on Date)}} \times 100\%$$
   - Avoids double-counting tasks that are both due and completed on the same date.
   - Displays `"No tasks"` when no task is due or completed on that day.

4. **Consistency Streak Counter**:
   - Consecutive days with at least one task completed.
   - If no task is completed today yet, the streak counts backwards starting from yesterday so that a streak is not prematurely lost until a full day is missed.
   - Re-completing an already completed task is rejected in C++ (`markComplete` returns `false`), preserving historical streak accuracy.

5. **Crash-Resilient Persistence (IDBFS + Atomic Temp Rename)**:
   - Serialized format: `id|description|completed|priority|dueDate|completedOn`.
   - Writes to `tasks.txt.tmp`, flushes and closes stream, then renames to `tasks.txt`.
   - `load()` skips corrupted or malformed records without halting the application.
   - Synchronized with browser IndexedDB via a non-overlapping queue (`FS.syncfs(false)`).

---

## 📁 Project Structure

```
oopc/
├── src/
│   ├── Task.h            # Task class definition (Rule of Zero, 6 fields)
│   ├── TaskManager.h     # TaskManager header (ownership chain)
│   ├── TaskManager.cpp   # Core logic, load/save, JSON serialization, analytics
│   ├── DateUtils.h       # Leap-year, date validation, and step-back functions
│   ├── DateUtils.cpp     # Implementation of calendar and string sanitization
│   └── bindings.cpp      # Embind bindings exposing C++ methods to JavaScript
├── tests/
│   └── test_main.cpp     # Comprehensive native unit tests for all features
├── public/
│   ├── index.html        # Responsive web UI layout
│   ├── style.css         # Modern styling, responsive cards, calendar grid
│   ├── app.js            # JavaScript glue, IDBFS sync queue, UI bindings
│   ├── task_engine.js    # Compiled Emscripten JavaScript glue
│   └── task_engine.wasm  # Compiled WebAssembly binary
├── build.bat             # Build script for Emscripten WASM compilation
├── vercel.json           # Vercel deployment configuration
├── .gitignore            # Git ignore rules
└── README.md             # Project documentation
```

---

## ⚙️ Compilation & Testing

### 1. WebAssembly Compilation (using Emscripten)
Ensure Emscripten SDK (`emsdk`) is installed and run:
```bat
build.bat
```
This runs:
```bat
em++ -O2 -std=c++17 --bind ^
    -s WASM=1 ^
    -s ALLOW_MEMORY_GROWTH=1 ^
    -s FORCE_FILESYSTEM=1 ^
    -lidbfs.js ^
    -s MODULARIZE=1 ^
    -s EXPORT_NAME="createTaskModule" ^
    src/DateUtils.cpp src/TaskManager.cpp src/bindings.cpp ^
    -o public/task_engine.js
```

### 2. Native C++ Unit Tests
Run unit tests with GCC or MSVC:
```bat
g++ -std=c++11 -Wall -Wextra src/DateUtils.cpp src/TaskManager.cpp tests/test_main.cpp -o run_tests.exe
run_tests.exe
```

---

## 🌐 Running Locally

You can serve the application locally using Python or Node.js:

```bash
# Using Node http-server or npx
npx serve public

# Or using Python:
python -m http.server 8000 --directory public
```
Then visit `http://localhost:8000` in your web browser.

---

## 🚢 Deploying to Vercel

1. Push this repository to GitHub:
   ```bash
   git add .
   git commit -m "Initial commit: C++ WebAssembly To-Do Application"
   git remote add origin https://github.com/your-username/your-repo.git
   git push -u origin master
   ```
2. Import the repository in [Vercel](https://vercel.com).
3. Vercel will automatically detect the static configuration from `vercel.json` and deploy it instantly.

