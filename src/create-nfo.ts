import { OptionValues } from '@commander-js/extra-typings';
import { AnimeNfo } from './nfo'

export function createNfoAction(path: string, opts: OptionValues): void {
    const anime = new AnimeNfo({
        uniqueId: [{type: "anidb", id: opts.aid ? parseInt(`${opts.aid}`) : 123}],
        title: 'My Anime',
        originaltitle: 'My Animation',
        season: 1,
        episode: 12,
        premiered: '1987-12-17',
        plot: "this is\nmy animation\nmine alone!",
        tagline: "It's mine!",
        mpaa: "X",
        tag: [
            'science',
            'space',
        ],
        studio: ['WIT'],
        actor: [
            {name: "Actor 1", role: "Character 1"},
            {name: "Actor 2", role: "Character 2"},
        ],
    }, path);

    console.log('TODO: indentify anime via anidb');
    console.log('TODO: use mapping to get tvdb and anilist ids');
    console.log('TODO: write nfo');
    anime.write()
}

// vim: tabstop=4 shiftwidth=4 softtabstop=0 smarttab expandtab
