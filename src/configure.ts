import { OptionValues } from '@commander-js/extra-typings';

export function configureAction(opts: OptionValues): void {
    console.log('TODO: implement configure command');
    console.log(`username=${opts.anidbUsername}`);
    console.log(`password=${opts.anidbPassword}`);
}

// vim: tabstop=4 shiftwidth=4 softtabstop=0 smarttab expandtab
