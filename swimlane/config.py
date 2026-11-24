"""Shared YAML configuration."""
import pathlib
import yaml
ROOT = pathlib.Path(__file__).resolve().parents[1]


def load_config(path=None):
    path = pathlib.Path(path or ROOT/'config.yaml').resolve()
    config = yaml.safe_load(path.read_text(encoding='utf-8'))
    if not isinstance(config, dict): raise ValueError('Configuration must be a YAML mapping')
    config['_base'] = path.parent
    if config['timing']['silence_seconds'] <= 0: raise ValueError('silence_seconds must be positive')
    for source in config['import']['sources'].values():
        if any(source[key] < 0 for key in ('min_calls', 'min_responses', 'limit')):
            raise ValueError('Import thresholds and limits must be nonnegative')
    return config


def resolve_path(config, value):
    path = pathlib.Path(value).expanduser()
    return path.resolve() if path.is_absolute() else (config['_base']/path).resolve()
