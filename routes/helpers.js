const mongoose = require('mongoose');

function isValidObjectId(id) {
    if (typeof id !== 'string') return false;
    return mongoose.Types.ObjectId.isValid(id) && new mongoose.Types.ObjectId(id).toString() === id;
}

function parseJsonParam(param, paramName) {
    if (param === undefined || param === null) return { success: true, value: undefined };
    if (typeof param === 'object') return { success: true, value: param };
    try {
        const parsed = JSON.parse(param);
        return { success: true, value: parsed };
    } catch (err) {
        return { success: false, error: `Invalid JSON format for '${paramName}' parameter` };
    }
}

function parseQueryParams(req, defaultLimit) {
    const whereRes = parseJsonParam(req.query.where, 'where');
    if (!whereRes.success) return whereRes;

    const sortRes = parseJsonParam(req.query.sort, 'sort');
    if (!sortRes.success) return sortRes;

    const selectRes = parseJsonParam(req.query.select, 'select');
    if (!selectRes.success) return selectRes;

    let skip;
    if (req.query.skip !== undefined) {
        const parsedSkip = parseInt(req.query.skip, 10);
        if (!isNaN(parsedSkip) && parsedSkip >= 0) {
            skip = parsedSkip;
        }
    }

    let limit = defaultLimit;
    if (req.query.limit !== undefined) {
        const parsedLimit = parseInt(req.query.limit, 10);
        if (!isNaN(parsedLimit) && parsedLimit >= 0) {
            limit = parsedLimit;
        }
    }

    const count = req.query.count === 'true' || req.query.count === true;

    return {
        success: true,
        where: whereRes.value || {},
        sort: sortRes.value,
        select: selectRes.value,
        skip,
        limit,
        count
    };
}

module.exports = {
    isValidObjectId,
    parseJsonParam,
    parseQueryParams
};

