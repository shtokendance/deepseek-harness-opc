// Extraction uses 7-Zip progress; other stages advance on installer milestones.
#pragma once
#include <algorithm>
#include <cstdint>

struct InstallProgress {
    int stage = 0;
    double value = 0;
    double target = 0;
    double from = 0;
    std::uint64_t animationStarted;
    bool succeeded = false;

    explicit InstallProgress(std::uint64_t now) : animationStarted(now) {}

    void Tick(std::uint64_t now) {
        const double duration = succeeded ? 600.0 : 250.0;
        const double fraction = std::min(1.0, (now - animationStarted) / duration);
        value = from + (target - from) * fraction;
    }

    void Advance(int nextStage, double fraction, std::uint64_t now) {
        Tick(now);
        if (succeeded || nextStage < stage || nextStage > 4) return;
        stage = nextStage;
        const double next = stage == 1 ? boundaries[1] + (boundaries[2] - boundaries[1]) * std::max(0.0, std::min(1.0, fraction))
            : boundaries[stage];
        if (next > target) {
            from = value;
            target = next;
            animationStarted = now;
        }
    }

    // Only the successful NSIS finish callback may authorize 100%.
    void Complete(std::uint64_t now) {
        if (succeeded) return;
        Tick(now);
        succeeded = true;
        from = value;
        target = 100;
        animationStarted = now;
    }

    int CaptionStage() const {
        int caption = 0;
        while (caption < stage && value >= boundaries[caption + 1]) ++caption;
        return caption;
    }

private:
    static constexpr double boundaries[] = {0, 2, 94, 96, 98};
};
