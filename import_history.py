"""Import configured local harness histories without modifying source logs."""
import argparse
import json
import pathlib
from swimlane.config import load_config, resolve_path
from swimlane.history import import_history


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=pathlib.Path)
    parser.add_argument('--output', type=pathlib.Path, help=argparse.SUPPRESS)
    parser.add_argument('--progress', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--incremental', action='store_true')
    parser.add_argument('--anonymize', action='store_true', default=None)
    args = parser.parse_args()
    config = load_config(args.config)
    def progress(stage, completed, total):
        if args.progress: print(json.dumps(dict(progress=True, stage=stage, completed=completed, total=total)), flush=True)
    output = args.output or resolve_path(config, config['import']['output'])
    index = import_history(config, output, progress, args.incremental, config['_base']/'.runtime/history-cache.json')
    if args.anonymize or config['import']['anonymize']:
        from swimlane.privacy import anonymize_directory
        progress('Anonymizing extracted content', 0, 1)
        anonymize_directory(output)
    progress('Ready', 1, 1)
    if not args.progress: print(json.dumps(dict(cases=len(index['cases']), errors=index['errors'])))


if __name__ == '__main__': main()
