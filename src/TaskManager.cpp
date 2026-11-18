#include "TaskManager.h"
#include "DateUtils.h"
#include <fstream>
#include <sstream>
#include <iostream>
#include <cstdlib>
#include <cstdio>
#include <unordered_set>
#include <iomanip>
#include <cmath>

TaskManager::TaskManager(const std::string& filename)
    : tasks_()
    , filename_(filename)
    , nextId_(1)
{
    load();
}

std::string TaskManager::escapeJson(const std::string& input) {
    std::ostringstream oss;
    for (char c : input) {
        switch (c) {
            case '"':  oss << "\\\""; break;
            case '\\': oss << "\\\\"; break;
            case '\b': oss << "\\b";  break;
            case '\f': oss << "\\f";  break;
            case '\n': oss << "\\n";  break;
            case '\r': oss << "\\r";  break;
            case '\t': oss << "\\t";  break;
            default:
                if (static_cast<unsigned char>(c) < 0x20) {
                    oss << "\\u" << std::hex << std::setw(4) << std::setfill('0') << static_cast<int>(c);
                } else {
                    oss << c;
                }
                break;
        }
    }
    return oss.str();
}

bool TaskManager::load() {
    std::ifstream file(filename_.c_str());
    if (!file.is_open()) {
        return false;
    }

    tasks_.clear();
    nextId_ = 1;

    std::string line;
    while (std::getline(file, line)) {
        if (line.empty()) {
            continue;
        }

        std::stringstream ss(line);
        std::string token;
        std::vector<std::string> fields;
        while (std::getline(ss, token, '|')) {
            fields.push_back(token);
        }

        // If line ended with a pipe, an empty trailing field exists
        if (!line.empty() && line.back() == '|') {
            fields.push_back("");
        }

        // We expect at least 4 required fields (id, desc, completed, prio)
        // Storage format has 6 fields: id|description|completed|priority|dueDate|completedOn
        if (fields.size() < 4) {
            continue; // Skip damaged line
        }

        std::string idStr = fields[0];
        std::string desc = fields[1];
        std::string doneStr = fields[2];
        std::string prioStr = fields[3];
        std::string due = fields.size() > 4 ? fields[4] : "";
        std::string completedOn = fields.size() > 5 ? fields[5] : "";

        // Strict numeric check for ID
        char* endp = nullptr;
        long parsedId = std::strtol(idStr.c_str(), &endp, 10);
        if (endp == idStr.c_str() || *endp != '\0' || parsedId <= 0) {
            continue; // Damaged line
        }

        // Strict numeric check for Priority (0 to 2)
        long parsedPrio = std::strtol(prioStr.c_str(), &endp, 10);
        if (endp == prioStr.c_str() || *endp != '\0' || parsedPrio < 0 || parsedPrio > 2) {
            continue; // Damaged line
        }

        // Description must not be empty
        if (desc.empty()) {
            continue; // Damaged line
        }

        // Completed flag must be "0" or "1"
        if (doneStr != "0" && doneStr != "1") {
            continue; // Damaged line
        }
        bool isDone = (doneStr == "1");

        // Due date: empty or valid YYYY-MM-DD
        if (!due.empty() && !DateUtils::isValidDate(due)) {
            continue; // Damaged line
        }

        // CompletedOn date check:
        // A completed task (completed = 1) with an empty completedOn is treated as damaged
        if (isDone) {
            if (completedOn.empty() || !DateUtils::isValidDate(completedOn)) {
                continue; // Damaged line
            }
        } else {
            if (!completedOn.empty() && !DateUtils::isValidDate(completedOn)) {
                continue; // Damaged line
            }
        }

        int id = static_cast<int>(parsedId);
        Priority prio = static_cast<Priority>(parsedPrio);

        tasks_.emplace_back(id, desc, prio, due, isDone, completedOn);

        if (id >= nextId_) {
            nextId_ = id + 1;
        }
    }

    return true;
}

bool TaskManager::save() {
    std::string tmpFilename = filename_ + ".tmp";
    {
        std::ofstream out(tmpFilename.c_str(), std::ios::trunc);
        if (!out.is_open()) {
            return false;
        }

        for (const auto& task : tasks_) {
            out << task.getId() << '|'
                << task.getDescription() << '|'
                << (task.isCompleted() ? "1" : "0") << '|'
                << static_cast<int>(task.getPriority()) << '|'
                << task.getDueDate() << '|'
                << task.getCompletedOn() << '\n';
        }
    } // out stream flushes and closes upon leaving scope

    // Atomically replace the old file with the new temporary file
    std::remove(filename_.c_str());
    if (std::rename(tmpFilename.c_str(), filename_.c_str()) != 0) {
        return false;
    }

    return true;
}

bool TaskManager::addTask(const std::string& desc, int priority, const std::string& dueDate) {
    std::string cleanDesc = DateUtils::sanitizeDescription(desc);
    if (cleanDesc.empty()) {
        return false;
    }

    if (priority < 0 || priority > 2) {
        return false;
    }

    if (!dueDate.empty() && !DateUtils::isValidDate(dueDate)) {
        return false;
    }

    tasks_.emplace_back(nextId_++, cleanDesc, static_cast<Priority>(priority), dueDate, false, "");
    save();
    return true;
}

bool TaskManager::markComplete(int id, const std::string& today) {
    if (!DateUtils::isValidDate(today)) {
        return false;
    }

    for (auto& task : tasks_) {
        if (task.getId() == id) {
            if (task.isCompleted()) {
                // Already completed; leave completedOn_ unchanged to protect past streaks
                return false;
            }
            task.setCompleted(true);
            task.setCompletedOn(today);
            save();
            return true;
        }
    }

    return false; // Task ID not found
}

bool TaskManager::updateTask(int id, const std::string& desc, int priority, const std::string& dueDate) {
    std::string cleanDesc = DateUtils::sanitizeDescription(desc);
    if (cleanDesc.empty()) {
        return false;
    }

    if (priority < 0 || priority > 2) {
        return false;
    }

    if (!dueDate.empty() && !DateUtils::isValidDate(dueDate)) {
        return false;
    }

    for (auto& task : tasks_) {
        if (task.getId() == id) {
            task.setDescription(cleanDesc);
            task.setPriority(static_cast<Priority>(priority));
            task.setDueDate(dueDate);
            save();
            return true;
        }
    }

    return false; // Task ID not found
}

bool TaskManager::deleteTask(int id) {
    for (size_t i = 0; i < tasks_.size(); ++i) {
        if (tasks_[i].getId() == id) {
            tasks_.erase(tasks_.begin() + i);
            save();
            return true;
        }
    }

    return false; // Task ID not found
}

std::string TaskManager::getTasksJson() const {
    std::ostringstream oss;
    oss << "[";
    for (size_t i = 0; i < tasks_.size(); ++i) {
        const auto& t = tasks_[i];
        if (i > 0) oss << ",";
        oss << "{"
            << "\"id\":" << t.getId() << ","
            << "\"description\":\"" << escapeJson(t.getDescription()) << "\","
            << "\"priority\":" << static_cast<int>(t.getPriority()) << ","
            << "\"dueDate\":\"" << escapeJson(t.getDueDate()) << "\","
            << "\"completed\":" << (t.isCompleted() ? "true" : "false") << ","
            << "\"completedOn\":\"" << escapeJson(t.getCompletedOn()) << "\""
            << "}";
    }
    oss << "]";
    return oss.str();
}

TaskManager::DayGoalIndicator TaskManager::computeDayGoalIndicator(int completed, int distinct) {
    DayGoalIndicator info;
    if (distinct <= 0) {
        info.hasTasks = false;
        info.rate = 0.0;
        info.rateLabel = "";
        info.tier = "none";
        info.bgColor = "";
        info.borderColor = "";
        info.textColor = "";
        info.darkBgColor = "";
        info.darkBorderColor = "";
        info.darkTextColor = "";
        return info;
    }

    info.hasTasks = true;
    double rawRate = (static_cast<double>(completed) / static_cast<double>(distinct)) * 100.0;
    if (rawRate < 0.0) rawRate = 0.0;
    if (rawRate > 100.0) rawRate = 100.0;

    info.rate = std::round(rawRate * 10.0) / 10.0;
    int roundedPct = static_cast<int>(std::round(rawRate));
    info.rateLabel = std::to_string(roundedPct) + "%";

    if (completed >= distinct) {
        // 100% daily goal met -> emerald green bubble (WCAG AA contrast >= 4.6:1 in light & dark)
        info.tier = "full";
        info.bgColor = "hsl(145, 65%, 32%)";
        info.borderColor = "hsl(145, 70%, 26%)";
        info.textColor = "#ffffff";
        info.darkBgColor = "hsl(145, 58%, 31%)";
        info.darkBorderColor = "hsl(145, 64%, 44%)";
        info.darkTextColor = "#ffffff";
    } else {
        if (rawRate == 0.0) {
            info.tier = "missed";
        } else if (rawRate < 40.0) {
            info.tier = "low";
        } else if (rawRate < 75.0) {
            info.tier = "medium";
        } else {
            info.tier = "high";
        }

        // Piecewise smooth HSL gradient computed in C++:
        // 0% -> 50%: Hue 0 (red) -> 40 (warm amber)
        // 50% -> 99%: Hue 40 (warm amber) -> 132 (fresh green)
        int hue = 0;
        if (rawRate <= 50.0) {
            hue = static_cast<int>(std::round((rawRate / 50.0) * 40.0));
        } else {
            hue = static_cast<int>(std::round(40.0 + ((rawRate - 50.0) / 50.0) * 92.0));
        }

        std::ostringstream bg, border, text, dbg, dborder, dtext;
        bg << "hsl(" << hue << ", 76%, 92%)";
        border << "hsl(" << hue << ", 68%, 54%)";
        text << "hsl(" << hue << ", 74%, 22%)";

        dbg << "hsl(" << hue << ", 42%, 19%)";
        dborder << "hsl(" << hue << ", 60%, 46%)";
        dtext << "hsl(" << hue << ", 90%, 84%)";

        info.bgColor = bg.str();
        info.borderColor = border.str();
        info.textColor = text.str();
        info.darkBgColor = dbg.str();
        info.darkBorderColor = dborder.str();
        info.darkTextColor = dtext.str();
    }

    return info;
}

std::string TaskManager::getCalendar(int year, int month) const {
    if (year < 1 || month < 1 || month > 12) {
        return "[]";
    }

    int days = DateUtils::daysInMonth(year, month);
    std::ostringstream oss;
    oss << "[";

    for (int d = 1; d <= days; ++d) {
        if (d > 1) oss << ",";

        std::ostringstream dateStream;
        dateStream << std::setfill('0')
                   << std::setw(4) << year << "-"
                   << std::setw(2) << month << "-"
                   << std::setw(2) << d;
        std::string dateStr = dateStream.str();

        int dueCount = 0;
        int completedCount = 0;
        std::unordered_set<int> distinctTaskIds;

        for (const auto& task : tasks_) {
            bool isDue = (task.getDueDate() == dateStr);
            bool isCompleted = (task.isCompleted() && task.getCompletedOn() == dateStr);

            if (isDue) {
                dueCount++;
                distinctTaskIds.insert(task.getId());
            }
            if (isCompleted) {
                completedCount++;
                distinctTaskIds.insert(task.getId());
            }
        }

        DayGoalIndicator goal = computeDayGoalIndicator(completedCount, static_cast<int>(distinctTaskIds.size()));

        oss << "{"
            << "\"day\":" << d << ","
            << "\"date\":\"" << dateStr << "\","
            << "\"due\":" << dueCount << ","
            << "\"completed\":" << completedCount << ","
            << "\"distinct\":" << distinctTaskIds.size() << ","
            << "\"hasTasks\":" << (goal.hasTasks ? "true" : "false") << ","
            << "\"rate\":" << std::fixed << std::setprecision(1) << goal.rate << ","
            << "\"rateLabel\":\"" << goal.rateLabel << "\","
            << "\"tier\":\"" << goal.tier << "\","
            << "\"bgColor\":\"" << goal.bgColor << "\","
            << "\"borderColor\":\"" << goal.borderColor << "\","
            << "\"textColor\":\"" << goal.textColor << "\","
            << "\"darkBgColor\":\"" << goal.darkBgColor << "\","
            << "\"darkBorderColor\":\"" << goal.darkBorderColor << "\","
            << "\"darkTextColor\":\"" << goal.darkTextColor << "\""
            << "}";
    }

    oss << "]";
    return oss.str();
}

double TaskManager::getDailyRate(const std::string& date) const {
    if (!DateUtils::isValidDate(date)) {
        return 0.0;
    }

    int completedCount = 0;
    std::unordered_set<int> distinctIds;

    for (const auto& task : tasks_) {
        bool isDue = (task.getDueDate() == date);
        bool isCompleted = (task.isCompleted() && task.getCompletedOn() == date);

        if (isCompleted) {
            completedCount++;
        }
        if (isDue || isCompleted) {
            distinctIds.insert(task.getId());
        }
    }

    if (distinctIds.empty()) {
        return 0.0;
    }

    return (static_cast<double>(completedCount) / static_cast<double>(distinctIds.size())) * 100.0;
}

int TaskManager::getStreak(const std::string& today) const {
    if (!DateUtils::isValidDate(today)) {
        return 0;
    }

    // Check if at least one task was completed on today
    bool completedToday = false;
    for (const auto& task : tasks_) {
        if (task.isCompleted() && task.getCompletedOn() == today) {
            completedToday = true;
            break;
        }
    }

    // If completed today, start counting from today; otherwise start from yesterday
    std::string checkDate = completedToday ? today : DateUtils::previousDay(today);
    int streak = 0;

    while (!checkDate.empty()) {
        bool completedOnDay = false;
        for (const auto& task : tasks_) {
            if (task.isCompleted() && task.getCompletedOn() == checkDate) {
                completedOnDay = true;
                break;
            }
        }

        if (completedOnDay) {
            streak++;
            checkDate = DateUtils::previousDay(checkDate);
        } else {
            break;
        }
    }

    return streak;
}

