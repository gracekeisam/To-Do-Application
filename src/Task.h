#ifndef TASK_H
#define TASK_H

#include <string>

enum class Priority {
    Low = 0,
    Medium = 1,
    High = 2
};

class Task {
private:
    int id_;
    std::string desc_;
    Priority prio_;
    std::string due_;
    bool done_;
    std::string completedOn_;

public:
    Task(int id,
         const std::string& desc,
         Priority prio,
         const std::string& due,
         bool done = false,
         const std::string& completedOn = "")
        : id_(id)
        , desc_(desc)
        , prio_(prio)
        , due_(due)
        , done_(done)
        , completedOn_(completedOn)
    {
    }

    // Rule of zero: compiler-generated destructor, copy and move constructors/operators
    ~Task() = default;
    Task(const Task&) = default;
    Task& operator=(const Task&) = default;
    Task(Task&&) noexcept = default;
    Task& operator=(Task&&) noexcept = default;

    // Getters
    int getId() const { return id_; }
    const std::string& getDescription() const { return desc_; }
    Priority getPriority() const { return prio_; }
    const std::string& getDueDate() const { return due_; }
    bool isCompleted() const { return done_; }
    const std::string& getCompletedOn() const { return completedOn_; }

    // Setters
    void setDescription(const std::string& desc) { desc_ = desc; }
    void setPriority(Priority prio) { prio_ = prio; }
    void setDueDate(const std::string& due) { due_ = due; }
    void setCompleted(bool done) { done_ = done; }
    void setCompletedOn(const std::string& completedOn) { completedOn_ = completedOn; }
};

#endif // TASK_H
