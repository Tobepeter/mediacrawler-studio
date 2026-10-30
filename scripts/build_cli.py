"""构建独立 CLI，保留原构建入口"""
import argparse
from build_python import build

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--clean', action='store_true')
    options = parser.parse_args()
    build('cli', options.clean)
