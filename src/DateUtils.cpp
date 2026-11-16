#include "DateUtils.h"
#include <sstream>
#include <iomanip>
#include <cctype>

namespace DateUtils {

bool isLeapYear(int year) {
    return (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0);
}

int daysInMonth(int year, int month) {
    if (month < 1 || month > 12) {
        return 0;
    }
    switch (month) {
        case 1:  return 31;
        case 2:  return isLeapYear(year) ? 29 : 28;
        case 3:  return 31;
        case 4:  return 30;
        case 5:  return 31;
        case 6:  return 30;
        case 7:  return 31;
        case 8:  return 31;
        case 9:  return 30;
        case 10: return 31;
        case 11: return 30;
        case 12: return 31;
        default: return 0;
    }
}

bool isValidDate(const std::string& date) {
    if (date.length() != 10) {
        return false;
    }
    if (date[4] != '-' || date[7] != '-') {
        return false;
    }
    for (size_t i = 0; i < 10; ++i) {
        if (i == 4 || i == 7) continue;
        if (!std::isdigit(static_cast<unsigned char>(date[i]))) {
            return false;
        }
    }

    int year = 0;
    int month = 0;
    int day = 0;

    try {
        year = std::stoi(date.substr(0, 4));
        month = std::stoi(date.substr(5, 2));
        day = std::stoi(date.substr(8, 2));
    } catch (...) {
        return false;
    }

    if (year < 1 || month < 1 || month > 12) {
        return false;
    }

    int maxDays = daysInMonth(year, month);
    if (day < 1 || day > maxDays) {
        return false;
    }

    return true;
}

std::string previousDay(const std::string& date) {
    if (!isValidDate(date)) {
        return "";
    }

    int year = std::stoi(date.substr(0, 4));
    int month = std::stoi(date.substr(5, 2));
    int day = std::stoi(date.substr(8, 2));

    day--;
    if (day < 1) {
        month--;
        if (month < 1) {
            month = 12;
            year--;
        }
        day = daysInMonth(year, month);
    }

    std::ostringstream oss;
    oss << std::setfill('0')
        << std::setw(4) << year << "-"
        << std::setw(2) << month << "-"
        << std::setw(2) << day;
    return oss.str();
}

std::string sanitizeDescription(const std::string& desc) {
    std::string result;
    result.reserve(desc.size());
    for (char c : desc) {
        if (c == '|') {
            result.push_back('/');
        } else if (c == '\n' || c == '\r') {
            result.push_back(' ');
        } else {
            result.push_back(c);
        }
    }
    // Trim leading and trailing spaces
    size_t first = result.find_first_not_of(" \t");
    if (first == std::string::npos) {
        return "";
    }
    size_t last = result.find_last_not_of(" \t");
    return result.substr(first, (last - first + 1));
}

} // namespace DateUtils

