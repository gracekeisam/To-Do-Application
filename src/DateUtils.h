#ifndef DATE_UTILS_H
#define DATE_UTILS_H

#include <string>

namespace DateUtils {
    // Leap year calculation
    bool isLeapYear(int year);

    // Number of days in a given month (1-12) for a given year
    int daysInMonth(int year, int month);

    // Validates YYYY-MM-DD format with leap-year awareness
    bool isValidDate(const std::string& date);

    // Steps backwards by exactly one calendar day across month and year boundaries
    std::string previousDay(const std::string& date);

    // Sanitizes descriptions: replaces '|' with '/', strips/replaces '\n' and '\r' with spaces
    std::string sanitizeDescription(const std::string& desc);
}

#endif // DATE_UTILS_H

