from dataclasses import dataclass


@dataclass(frozen=True)
class Sample:
    source: str
    source_timestamp: float
    sequence: int
    payload: bytes


class TimestampQueue:
    def __init__(self, max_size: int = 1024) -> None:
        if max_size < 1:
            raise ValueError("max_size must be positive")
        self._max_size = max_size
        self._items: list[Sample] = []

    def push(self, sample: Sample) -> None:
        if not sample.source:
            raise ValueError("sample source is required")
        if len(self._items) >= self._max_size:
            raise OverflowError("timestamp queue is full")
        self._items.append(sample)
        self._items.sort(key=lambda item: item.source_timestamp)

    def pop(self) -> Sample:
        return self._items.pop(0)

    def __len__(self) -> int:
        return len(self._items)

    def snapshot(self) -> tuple[Sample, ...]:
        return tuple(self._items)
