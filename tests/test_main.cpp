#include "../src/Task.h"
#include "../src/TaskManager.h"
#include "../src/DateUtils.h"
#include <iostream>
#include <cassert>
#include <fstream>
#include <cmath>

void testDateUtils() {
    std::cout << "[Test] DateUtils...\n";

    // Leap years
    assert(DateUtils::isLeapYear(2000) == true);
    assert(DateUtils::isLeapYear(2024) == true);
    assert(DateUtils::isLeapYear(1900) == false);
    assert(DateUtils::isLeapYear(2023) == false);

    // Days in month
    assert(DateUtils::daysInMonth(2024, 2) == 29);
    assert(DateUtils::daysInMonth(2023, 2) == 28);
    assert(DateUtils::daysInMonth(2024, 1) == 31);
    assert(DateUtils::daysInMonth(2024, 4) == 30);

    // Valid date
    assert(DateUtils::isValidDate("2024-02-29") == true);
    assert(DateUtils::isValidDate("2023-02-29") == false);
    assert(DateUtils::isValidDate("2024-02-30") == false);
    assert(DateUtils::isValidDate("2024-04-31") == false);
    assert(DateUtils::isValidDate("2024-12-31") == true);
    assert(DateUtils::isValidDate("invalid-date") == false);
    assert(DateUtils::isValidDate("") == false);

    // Stepping backwards
    assert(DateUtils::previousDay("2024-03-01") == "2024-02-29");
    assert(DateUtils::previousDay("2023-03-01") == "2023-02-28");
    assert(DateUtils::previousDay("2024-01-01") == "2023-12-31");
    assert(DateUtils::previousDay("2024-05-15") == "2024-05-14");

    // Sanitization
    std::string badText = "Buy milk|bread\nand eggs\r\n";
    std::string cleanText = DateUtils::sanitizeDescription(badText);
    assert(cleanText.find('|') == std::string::npos);
    assert(cleanText.find('\n') == std::string::npos);
    assert(cleanText.find('\r') == std::string::npos);
    assert(cleanText == "Buy milk/bread and eggs");

    std::cout << "  Passed DateUtils tests!\n";
}

void testTaskManagerBasic() {
    std::cout << "[Test] TaskManager Core Operations...\n";
    std::string testFile = "test_tasks.txt";
    std::remove(testFile.c_str());
    std::remove((testFile + ".tmp").c_str());

    TaskManager tm(testFile);
    assert(tm.getTaskCount() == 0);

    // Add task
    assert(tm.addTask("Task 1 | urgent", 2, "2026-11-20") == true);
    assert(tm.addTask("", 1, "2026-11-21") == false); // empty description rejected
    assert(tm.addTask("Task 2", 3, "2026-11-21") == false); // invalid priority rejected
    assert(tm.addTask("Task 2", 1, "2026-02-29") == false); // invalid leap year date rejected (2026 is not leap)
    assert(tm.addTask("Task 2", 1, "2026-11-21") == true);

    assert(tm.getTaskCount() == 2);

    // Mark complete
    assert(tm.markComplete(999, "2026-11-16") == false); // non-existent ID
    assert(tm.markComplete(1, "invalid-date") == false); // invalid date
    assert(tm.markComplete(1, "2026-11-16") == true);
    // Cannot re-complete already completed task
    assert(tm.markComplete(1, "2026-11-17") == false);

    // Update task
    assert(tm.updateTask(2, "Task 2 Updated", 0, "2026-11-25") == true);
    assert(tm.updateTask(999, "None", 0, "2026-11-25") == false);

    // Delete task
    assert(tm.deleteTask(999) == false);
    assert(tm.deleteTask(2) == true);
    assert(tm.getTaskCount() == 1);

    // Test reload from disk
    TaskManager tm2(testFile);
    assert(tm2.getTaskCount() == 1);
    // nextId_ should be preserved and greater than highest stored ID
    assert(tm2.getNextId() == 2);

    std::remove(testFile.c_str());
    std::remove((testFile + ".tmp").c_str());
    std::cout << "  Passed TaskManager Core Operations tests!\n";
}

void testDamagedLines() {
    std::cout << "[Test] Damaged Line Recovery...\n";
    std::string testFile = "test_corrupt.txt";
    std::ofstream out(testFile);
    out << "1|Valid Task|0|1|2026-11-20|\n";
    out << "abc|Bad ID|0|1|2026-11-20|\n"; // bad numeric ID
    out << "2||0|1|2026-11-20|\n"; // empty description
    out << "3|Bad Priority|0|5|2026-11-20|\n"; // priority > 2
    out << "4|Bad Due Date|0|1|2026-02-30|\n"; // invalid date
    out << "5|Completed But No Date|1|1|2026-11-20|\n"; // completed=1 but empty completedOn! Damaged
    out << "6|Valid Completed Task|1|2|2026-11-15|2026-11-16\n";
    out.close();

    TaskManager tm(testFile);
    // Only tasks 1 and 6 are valid!
    assert(tm.getTaskCount() == 2);
    assert(tm.getNextId() == 7);

    std::remove(testFile.c_str());
    std::cout << "  Passed Damaged Line Recovery tests!\n";
}

void testAnalyticsAndStreak() {
    std::cout << "[Test] Analytics, Calendar & Streaks...\n";
    std::string testFile = "test_analytics.txt";
    std::remove(testFile.c_str());

    TaskManager tm(testFile);
    // 3 tasks due or completed on 2026-11-16
    // Task 1: due 2026-11-16, completed on 2026-11-16
    tm.addTask("T1", 1, "2026-11-16");
    tm.markComplete(1, "2026-11-16");

    // Task 2: due 2026-11-16, not completed
    tm.addTask("T2", 1, "2026-11-16");

    // Task 3: due 2026-11-20, completed on 2026-11-16
    tm.addTask("T3", 1, "2026-11-20");
    tm.markComplete(3, "2026-11-16");

    // Distinct tasks due or completed on 2026-11-16:
    // T1 (due & completed), T2 (due), T3 (completed) -> total 3 distinct
    // Completed on 2026-11-16: T1 and T3 -> 2
    // Daily rate = 2 / 3 * 100 = 66.666...%
    double rate = tm.getDailyRate("2026-11-16");
    assert(std::abs(rate - (2.0 / 3.0 * 100.0)) < 0.01);

    // No tasks on 2026-11-10 -> rate returns 0.0
    assert(tm.getDailyRate("2026-11-10") == 0.0);

    // Streak testing:
    // Suppose tasks completed on:
    // 2026-11-14
    // 2026-11-15
    // 2026-11-16
    tm.addTask("T4", 1, "2026-11-14");
    tm.markComplete(4, "2026-11-14");

    tm.addTask("T5", 1, "2026-11-15");
    tm.markComplete(5, "2026-11-15");

    // Today is 2026-11-16:
    // We have completions on 16, 15, 14 -> streak is 3
    assert(tm.getStreak("2026-11-16") == 3);

    // Tomorrow is 2026-11-17: user hasn't completed any task yet today.
    // Streak should count from yesterday (16) -> still 3!
    assert(tm.getStreak("2026-11-17") == 3);

    // Day after tomorrow 2026-11-18: if nothing completed on 17, streak resets to 0!
    assert(tm.getStreak("2026-11-18") == 0);

    std::remove(testFile.c_str());
    std::cout << "  Passed Analytics, Calendar & Streaks tests!\n";
}

int main() {
    std::cout << "Running C++ Task Engine Unit Tests...\n";
    testDateUtils();
    testTaskManagerBasic();
    testDamagedLines();
    testAnalyticsAndStreak();
    std::cout << "All tests passed successfully!\n";
    return 0;
}

