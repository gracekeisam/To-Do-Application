#ifndef TASK_MANAGER_H
#define TASK_MANAGER_H

#include "Task.h"
#include <vector>
#include <string>

class TaskManager {
private:
    // Members in exact declaration order according to architecture specification
    std::vector<Task> tasks_;
    std::string filename_;
    int nextId_;

    // Helper for JSON escaping
    static std::string escapeJson(const std::string& input);

public:
    explicit TaskManager(const std::string& filename = "tasks.txt");

    // Rule of zero
    ~TaskManager() = default;
    TaskManager(const TaskManager&) = delete;
    TaskManager& operator=(const TaskManager&) = delete;
    TaskManager(TaskManager&&) noexcept = default;
    TaskManager& operator=(TaskManager&&) noexcept = default;

    // File persistence
    bool load();
    bool save();

    // Core task operations
    bool addTask(const std::string& desc, int priority, const std::string& dueDate);
    bool markComplete(int id, const std::string& today);
    bool updateTask(int id, const std::string& desc, int priority, const std::string& dueDate);
    bool deleteTask(int id);

    // Queries and analytics
    std::string getTasksJson() const;
    std::string getCalendar(int year, int month) const;
    double getDailyRate(const std::string& date) const;
    int getStreak(const std::string& today) const;

    // Inspection helpers
    size_t getTaskCount() const { return tasks_.size(); }
    int getNextId() const { return nextId_; }
};

#endif // TASK_MANAGER_H
