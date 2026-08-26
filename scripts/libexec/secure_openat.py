#!/usr/bin/python3
"""Small POSIX openat helper for capability-relative secure leaf I/O.

Directory file descriptor 3 is inherited from the Node parent.  The helper
never resolves the leaf through an absolute pathname.
"""

import json
import os
import stat
import sys


FILE_ERROR = "CLOUDFLARE_E_SIGNING_FILE"
FILE_EXISTS = "CLOUDFLARE_E_SIGNING_FILE_EXISTS"
FILE_RACE = "CLOUDFLARE_E_SIGNING_FILE_RACE"


def fail(code):
    sys.stderr.write(code + "\n")
    raise SystemExit(17 if code == FILE_EXISTS else 1)


def metadata(info):
    return {
        "dev": info.st_dev,
        "ino": info.st_ino,
        "mode": stat.S_IMODE(info.st_mode),
        "nlink": info.st_nlink,
        "size": info.st_size,
        "mtimeNs": str(info.st_mtime_ns),
        "ctimeNs": str(info.st_ctime_ns),
    }


def assert_directory(directory):
    if not stat.S_ISDIR(directory.st_mode) or stat.S_IMODE(directory.st_mode) != 0o700:
        fail(FILE_ERROR)
    if hasattr(os, "getuid") and directory.st_uid != os.getuid():
        fail(FILE_ERROR)


def assert_leaf(info, maximum, allow_empty=False):
    minimum = 0 if allow_empty else 1
    if (
        not stat.S_ISREG(info.st_mode)
        or info.st_nlink != 1
        or stat.S_IMODE(info.st_mode) != 0o600
        or info.st_size < minimum
        or info.st_size > maximum
    ):
        fail(FILE_ERROR)
    if hasattr(os, "getuid") and info.st_uid != os.getuid():
        fail(FILE_ERROR)


def linked_leaf(leaf):
    try:
        return os.stat(leaf, dir_fd=3, follow_symlinks=False)
    except (FileNotFoundError, NotADirectoryError):
        fail(FILE_RACE)
    except OSError:
        fail(FILE_ERROR)


def assert_same(left, right, include_times=True):
    same = (
        left.st_dev == right.st_dev
        and left.st_ino == right.st_ino
        and left.st_mode == right.st_mode
        and left.st_nlink == right.st_nlink
        and left.st_size == right.st_size
    )
    if include_times:
        same = same and left.st_mtime_ns == right.st_mtime_ns and left.st_ctime_ns == right.st_ctime_ns
    if not same:
        fail(FILE_RACE)


def assert_directory_same(left, right):
    if (
        left.st_dev != right.st_dev
        or left.st_ino != right.st_ino
        or left.st_mode != right.st_mode
        or left.st_uid != right.st_uid
    ):
        fail(FILE_RACE)


def read_all(fd, size):
    output = bytearray()
    while len(output) < size:
        chunk = os.read(fd, size - len(output))
        if not chunk:
            fail(FILE_RACE)
        output.extend(chunk)
    if os.read(fd, 1):
        fail(FILE_RACE)
    return bytes(output)


def read_stdin(maximum):
    output = bytearray()
    while True:
        chunk = os.read(0, min(65536, maximum + 1 - len(output)))
        if not chunk:
            break
        output.extend(chunk)
        if len(output) > maximum:
            fail(FILE_ERROR)
    if not output:
        fail(FILE_ERROR)
    return bytes(output)


def open_leaf(leaf, flags, mode=None):
    try:
        if mode is None:
            return os.open(leaf, flags, dir_fd=3)
        return os.open(leaf, flags, mode, dir_fd=3)
    except FileExistsError:
        fail(FILE_EXISTS)
    except (FileNotFoundError, NotADirectoryError, PermissionError, IsADirectoryError):
        fail(FILE_ERROR)
    except OSError as error:
        if error.errno in (getattr(os, "ELOOP", 62),):
            fail(FILE_ERROR)
        fail(FILE_ERROR)


def emit_success(info, data=b""):
    if data:
        os.write(1, data)
    sys.stderr.write(json.dumps(metadata(info), separators=(",", ":"), sort_keys=True) + "\n")


def main():
    if len(sys.argv) != 4:
        fail(FILE_ERROR)
    operation, leaf, maximum_raw = sys.argv[1:]
    if operation not in ("absent", "read", "create") or not leaf or leaf in (".", ".."):
        fail(FILE_ERROR)
    if "/" in leaf or "\\" in leaf or "\x00" in leaf or len(os.fsencode(leaf)) > 255:
        fail(FILE_ERROR)
    try:
        maximum = int(maximum_raw)
    except ValueError:
        fail(FILE_ERROR)
    if maximum < 1 or maximum > 16 * 1024 * 1024:
        fail(FILE_ERROR)
    try:
        directory_before = os.fstat(3)
    except OSError:
        fail(FILE_ERROR)
    assert_directory(directory_before)

    nofollow = getattr(os, "O_NOFOLLOW", 0)
    cloexec = getattr(os, "O_CLOEXEC", 0)
    if nofollow == 0 or not hasattr(os, "supports_dir_fd") or os.open not in os.supports_dir_fd:
        fail(FILE_ERROR)

    if operation == "absent":
        try:
            os.stat(leaf, dir_fd=3, follow_symlinks=False)
        except FileNotFoundError:
            directory_after = os.fstat(3)
            assert_same(directory_before, directory_after)
            emit_success(directory_after)
            return
        except OSError:
            fail(FILE_ERROR)
        fail(FILE_EXISTS)

    if operation == "read":
        fd = open_leaf(leaf, os.O_RDONLY | nofollow | cloexec)
        try:
            before = os.fstat(fd)
            assert_leaf(before, maximum)
            data = read_all(fd, before.st_size)
            after = os.fstat(fd)
            linked = linked_leaf(leaf)
            assert_leaf(after, maximum)
            assert_leaf(linked, maximum)
            assert_same(before, after)
            assert_same(before, linked)
            assert_same(directory_before, os.fstat(3))
            emit_success(after, data)
        finally:
            os.close(fd)
        return

    data = read_stdin(maximum)
    fd = open_leaf(leaf, os.O_CREAT | os.O_EXCL | os.O_RDWR | nofollow | cloexec, 0o600)
    try:
        os.fchmod(fd, 0o600)
        initial = os.fstat(fd)
        assert_leaf(initial, maximum, allow_empty=True)
        offset = 0
        while offset < len(data):
            written = os.write(fd, data[offset:])
            if written <= 0:
                fail(FILE_ERROR)
            offset += written
        os.fsync(fd)
        os.lseek(fd, 0, os.SEEK_SET)
        observed = read_all(fd, len(data))
        after = os.fstat(fd)
        linked = linked_leaf(leaf)
        assert_leaf(after, maximum)
        assert_leaf(linked, maximum)
        if observed != data:
            fail(FILE_RACE)
        assert_same(after, linked)
        if initial.st_dev != after.st_dev or initial.st_ino != after.st_ino:
            fail(FILE_RACE)
        os.fsync(3)
        assert_directory_same(directory_before, os.fstat(3))
        emit_success(after)
    finally:
        os.close(fd)


if __name__ == "__main__":
    main()
