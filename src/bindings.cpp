#ifdef __EMSCRIPTEN__
#include "TaskManager.h"
#include "DateUtils.h"
#include <emscripten/bind.h>

using namespace emscripten;

EMSCRIPTEN_BINDINGS(task_manager_module) {
    enum_<Priority>("Priority")
        .value("Low", Priority::Low)
        .value("Medium", Priority::Medium)
        .value("High", Priority::High);

    class_<TaskManager>("TaskManager")
        .constructor<>()
        .constructor<std::string>()
        .function("addTask", &TaskManager::addTask)
        .function("markComplete", &TaskManager::markComplete)
        .function("updateTask", &TaskManager::updateTask)
        .function("deleteTask", &TaskManager::deleteTask)
        .function("getTasksJson", &TaskManager::getTasksJson)
        .function("getCalendar", &TaskManager::getCalendar)
        .function("getDailyRate", &TaskManager::getDailyRate)
        .function("getStreak", &TaskManager::getStreak)
        .function("getTaskCount", &TaskManager::getTaskCount)
        .function("getNextId", &TaskManager::getNextId);

    function("isValidDate", &DateUtils::isValidDate);
    function("daysInMonth", &DateUtils::daysInMonth);
    function("previousDay", &DateUtils::previousDay);
}
#endif
