"""Report Markdown source lines worth reviewing; do not reflow them."""

import argparse
import sys
from pathlib import Path

REVIEW_WIDTH = 132


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", type=Path, nargs="+", metavar="FILE")
    failed = False
    for path in parser.parse_args().files:
        try:
            with path.open(encoding="utf-8") as source:
                for number, line in enumerate(source, start=1):
                    width = len(line.rstrip("\n"))
                    if width > REVIEW_WIDTH:
                        print(f"{path}:{number}: {width}")
        except (OSError, UnicodeError) as error:
            print(f"{path}: {error}", file=sys.stderr)
            failed = True
    return int(failed)


if __name__ == "__main__":
    sys.exit(main())
