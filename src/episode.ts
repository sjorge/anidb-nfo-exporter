/*
 * Module with helper classes for dealing with episodes
 *
 * EpisodeMapper
 * - detect episodes in animeDir
 */
import fs from 'node:fs';
import path from 'node:path';

export type EpisodeFile = {
    path: string;
    episodeStart: string;
    episodeEnd: string;
    title: string;
};

const episodeExtensions: string[] = [
    '.mkv', '.mp4','.ogm', '.avi',
];

export class EpisodeMapper {
    private path: string;

    public constructor(animeDir: string) {
        this.path = animeDir;

        // check path exists
        if(!fs.existsSync(this.path) || !fs.statSync(this.path).isDirectory()) {
            throw new Error(`The path '${this.path}' does not exist or is not a directory!`);
        }
    }

    public episodes(): EpisodeFile[] {
        const episodes: EpisodeFile[] = [];
        const anidbEpisodeTitle = new RegExp(/\s-\s(?<episode>(S|C|T|P|O|E)?\d+)\s-\s(?<title>.+)\.\w{3}/);
        const anidbMultiEpisodeTitle = new RegExp(/\s-\s(?<episode>(S|C|T|P|O)?\d+-(S|C|T|P|O)?\d+)\s-\s(?<title>.+)\.\w{3}/);
        const titleCrc32 = new RegExp(/.+(?<crc32>\([A-Za-z0-9]{8}\))/);

        fs.readdirSync(this.path).forEach((episodePath: string) => {
            if (episodeExtensions.includes(path.extname(episodePath))) {
                const anidbTitleMatches = anidbEpisodeTitle.exec(episodePath)?.groups;
                const anidbMultiTitleMatches = anidbMultiEpisodeTitle.exec(episodePath)?.groups;

                if (anidbTitleMatches) {
                    let title = anidbTitleMatches?.title;
                    let episode = anidbTitleMatches?.episode;
                    if (episode.substring(0, 1) == "0") episode = `${parseInt(episode)}`;

                    const crc32Match = titleCrc32.exec(title)?.groups;
                    if (crc32Match) title = title.replace(crc32Match?.crc32, '');

                    episodes.push({
                        path: path.join(this.path, episodePath),
                        episodeStart: episode,
                        episodeEnd: episode,
                        title: title.trim(),
                    } as EpisodeFile);
                } else if (anidbMultiTitleMatches) {
                    let title = anidbMultiTitleMatches?.title;
                    let episode = anidbMultiTitleMatches?.episode.split('-');
                    episode = episode.map((ep: string): string => { return `${parseInt(ep)}`; })

                    const crc32Match = titleCrc32.exec(title)?.groups;
                    if (crc32Match) title = title.replace(crc32Match?.crc32, '');

                    episodes.push({
                        path: path.join(this.path, episodePath),
                        episodeStart: episode[0],
                        episodeEnd: episode[1],
                        title: title.trim(),
                    } as EpisodeFile);
                } else {
                    console.error(`Failed to parse episode file: ${episodePath}`);
                }
            }
        });

        return episodes;
    }
}
