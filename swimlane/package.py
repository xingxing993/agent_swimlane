"""Build an offline, single HTML artifact without changing local data."""
import json
import pathlib
from swimlane.privacy import Anonymizer


def build_package(root, scramble=False):
    index=json.loads((root/'data/index.json').read_text(encoding='utf-8'))
    privacy=Anonymizer()
    payload={}
    for row in index['cases']:
        case=json.loads((root/'data'/row['file']).read_text(encoding='utf-8'))
        if scramble:
            case=privacy.transform(case)
            case['title']='Session '+case['id'][:12]
            case['anonymization']={'mode':'content-masked'}
        output_file=privacy.alias(row['file'][:-5])+'.json' if scramble else row['file']
        payload['/data/'+output_file]=case
    if scramble:
        # Apply the same filename map to the index and embedded lookups.
        for row in index['cases']:
            original_file=row['file']
            masked=privacy.transform(row)
            row.update(masked,title='Session '+masked['id'][:12])
        index['anonymization']={'mode':'content-masked'}
        index['errors']=[]
    payload['/data/index.json']=index
    encoded=json.dumps(payload,ensure_ascii=True).replace('<','\\u003c')
    bootstrap="const packagedData="+encoded+";window.fetch=async url=>({ok:!!packagedData[url],status:packagedData[url]?200:404,json:async()=>packagedData[url]});"
    html=(root/'web/index.html').read_text(encoding='utf-8')
    html=html.replace('<link rel="stylesheet" href="/style.css">','<style>'+(root/'web/style.css').read_text(encoding='utf-8')+'</style>')
    for name in ('timeline.js','app.js','import.js'):
        replacement='' if name=='import.js' else '<script>'+ (bootstrap if name=='timeline.js' else '')+(root/'web'/name).read_text(encoding='utf-8').replace('</script','<\\/script')+'</script>'
        # Inline scripts must run after the document elements exist.
        html=html.replace('<script src="/'+name+'" defer></script>','')
        html=html.replace('</body>',replacement+'</body>')
    html=html.replace('<button id="importButton" class="button">Import local history</button>','<p>Offline snapshot · local imports require the application server.</p>')
    html=html.replace('<button id="packageButton" class="button">Create package ↓</button>','')
    return html


if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scramble',action='store_true')
    parser.add_argument('--output',type=pathlib.Path,default=pathlib.Path('agent-swimlane.html'))
    args=parser.parse_args()
    args.output.write_text(build_package(pathlib.Path(__file__).resolve().parents[1],args.scramble),encoding='utf-8')
    print(args.output)
