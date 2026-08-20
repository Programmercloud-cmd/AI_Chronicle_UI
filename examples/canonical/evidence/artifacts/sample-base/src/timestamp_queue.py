from dataclasses import dataclass


@dataclass(frozen=True)
class Sample:
    source_timestamp: float
    payload: bytes


class TimestampQueue:
    def __init__(self) -> None:
        self._items: list[Sample] = []

    def push(self, sample: Sample) -> None:
        self._items.append(sample)
        self._items.sort(key=lambda item: item.source_timestamp)

    def pop(self) -> Sample:
        return self._items.pop(0)
