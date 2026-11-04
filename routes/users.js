const express = require('express');
const User = require('../models/user');
const Task = require('../models/task');
const { isValidObjectId, parseJsonParam, parseQueryParams } = require('./helpers');

module.exports = function (router) {
    const usersRoute = router.route('/users');
    const userDetailRoute = router.route('/users/:id');

    // GET /api/users
    usersRoute.get(async function (req, res) {
        try {
            const queryParsed = parseQueryParams(req, undefined); // unlimited default for users
            if (!queryParsed.success) {
                return res.status(400).json({ message: 'Bad Request', data: queryParsed.error });
            }

            if (queryParsed.count) {
                const count = await User.countDocuments(queryParsed.where);
                return res.status(200).json({ message: 'OK', data: count });
            }

            let query = User.find(queryParsed.where);
            if (queryParsed.sort) query = query.sort(queryParsed.sort);
            if (queryParsed.select) query = query.select(queryParsed.select);
            if (queryParsed.skip !== undefined) query = query.skip(queryParsed.skip);
            if (queryParsed.limit !== undefined) query = query.limit(queryParsed.limit);

            const users = await query.exec();
            return res.status(200).json({ message: 'OK', data: users });
        } catch (err) {
            return res.status(500).json({ message: 'Internal Server Error', data: 'An unexpected error occurred' });
        }
    });

    // POST /api/users
    usersRoute.post(async function (req, res) {
        try {
            const { name, email, pendingTasks } = req.body;

            // Validation order: field format and values (400)
            if (!name || typeof name !== 'string' || name.trim() === '') {
                return res.status(400).json({ message: 'Bad Request', data: 'Name is required and must be a string' });
            }
            if (!email || typeof email !== 'string' || email.trim() === '') {
                return res.status(400).json({ message: 'Bad Request', data: 'Email is required and must be a string' });
            }

            const trimmedEmail = email.trim();
            const existingUser = await User.findOne({ email: trimmedEmail });
            if (existingUser) {
                return res.status(400).json({ message: 'Bad Request', data: 'User with this email already exists' });
            }

            let taskIds = [];
            if (pendingTasks !== undefined) {
                if (!Array.isArray(pendingTasks)) {
                    return res.status(400).json({ message: 'Bad Request', data: 'pendingTasks must be an array of IDs' });
                }
                for (const tid of pendingTasks) {
                    if (!isValidObjectId(tid)) {
                        return res.status(400).json({ message: 'Bad Request', data: `Invalid task ID format in pendingTasks: ${tid}` });
                    }
                }
                taskIds = Array.from(new Set(pendingTasks));
            }

            // Check if referenced tasks exist (404)
            if (taskIds.length > 0) {
                const foundTasks = await Task.find({ _id: { $in: taskIds } });
                if (foundTasks.length !== taskIds.length) {
                    return res.status(404).json({ message: 'Not Found', data: 'One or more tasks in pendingTasks do not exist' });
                }

                // Check if any referenced task is completed (400)
                const completedTask = foundTasks.find(t => t.completed === true);
                if (completedTask) {
                    return res.status(400).json({ message: 'Bad Request', data: 'Cannot assign completed task to pendingTasks' });
                }
            }

            const newUser = new User({
                name: name.trim(),
                email: trimmedEmail,
                pendingTasks: taskIds,
                dateCreated: new Date()
            });

            await newUser.save();

            // Reconcile two-way references
            if (taskIds.length > 0) {
                // If any task was assigned to another user, remove from their pendingTasks
                await User.updateMany(
                    { _id: { $ne: newUser._id }, pendingTasks: { $in: taskIds } },
                    { $pull: { pendingTasks: { $in: taskIds } } }
                );

                // Assign tasks to new user
                await Task.updateMany(
                    { _id: { $in: taskIds } },
                    { assignedUser: newUser._id.toString(), assignedUserName: newUser.name }
                );
            }

            return res.status(201).json({ message: 'User created', data: newUser });
        } catch (err) {
            return res.status(500).json({ message: 'Internal Server Error', data: 'An unexpected error occurred' });
        }
    });

    // GET /api/users/:id
    userDetailRoute.get(async function (req, res) {
        try {
            if (!isValidObjectId(req.params.id)) {
                return res.status(404).json({ message: 'Not Found', data: 'User not found' });
            }

            let selectOption;
            if (req.query.select !== undefined) {
                const selectParsed = parseJsonParam(req.query.select, 'select');
                if (!selectParsed.success) {
                    return res.status(400).json({ message: 'Bad Request', data: selectParsed.error });
                }
                selectOption = selectParsed.value;
            }

            let query = User.findById(req.params.id);
            if (selectOption) query = query.select(selectOption);

            const user = await query.exec();
            if (!user) {
                return res.status(404).json({ message: 'Not Found', data: 'User not found' });
            }

            return res.status(200).json({ message: 'OK', data: user });
        } catch (err) {
            return res.status(500).json({ message: 'Internal Server Error', data: 'An unexpected error occurred' });
        }
    });

    // PUT /api/users/:id
    userDetailRoute.put(async function (req, res) {
        try {
            // Check 1: URL id (404)
            if (!isValidObjectId(req.params.id)) {
                return res.status(404).json({ message: 'Not Found', data: 'User not found' });
            }

            const user = await User.findById(req.params.id);
            if (!user) {
                return res.status(404).json({ message: 'Not Found', data: 'User not found' });
            }

            // Check 2: field format and values (400)
            const { name, email, pendingTasks } = req.body;
            if (!name || typeof name !== 'string' || name.trim() === '') {
                return res.status(400).json({ message: 'Bad Request', data: 'Name is required and must be a string' });
            }
            if (!email || typeof email !== 'string' || email.trim() === '') {
                return res.status(400).json({ message: 'Bad Request', data: 'Email is required and must be a string' });
            }

            let taskIds = [];
            if (pendingTasks !== undefined) {
                if (!Array.isArray(pendingTasks)) {
                    return res.status(400).json({ message: 'Bad Request', data: 'pendingTasks must be an array of IDs' });
                }
                for (const tid of pendingTasks) {
                    if (!isValidObjectId(tid)) {
                        return res.status(400).json({ message: 'Bad Request', data: `Invalid task ID format in pendingTasks: ${tid}` });
                    }
                }
                taskIds = Array.from(new Set(pendingTasks));
            }

            const trimmedEmail = email.trim();
            const emailUser = await User.findOne({ email: trimmedEmail, _id: { $ne: user._id } });
            if (emailUser) {
                return res.status(400).json({ message: 'Bad Request', data: 'Email is already used by another user' });
            }

            // Check 3: whether referenced tasks exist (404)
            let foundTasks = [];
            if (taskIds.length > 0) {
                foundTasks = await Task.find({ _id: { $in: taskIds } });
                if (foundTasks.length !== taskIds.length) {
                    return res.status(404).json({ message: 'Not Found', data: 'One or more tasks in pendingTasks do not exist' });
                }

                // Check 4: completed task in pendingTasks (400)
                const completedTask = foundTasks.find(t => t.completed === true);
                if (completedTask) {
                    return res.status(400).json({ message: 'Bad Request', data: 'Cannot assign completed task to pendingTasks' });
                }
            }

            const oldPendingTasks = user.pendingTasks || [];
            const newPendingTasks = taskIds;
            const nameChanged = user.name !== name.trim();

            const toRemove = oldPendingTasks.filter(id => !newPendingTasks.includes(id));
            const toAdd = newPendingTasks.filter(id => !oldPendingTasks.includes(id));

            user.name = name.trim();
            user.email = trimmedEmail;
            user.pendingTasks = newPendingTasks;
            // dateCreated is preserved unchanged
            await user.save();

            // Reconcile references
            // Tasks removed from pendingTasks -> unassign
            if (toRemove.length > 0) {
                await Task.updateMany(
                    { _id: { $in: toRemove } },
                    { assignedUser: '', assignedUserName: 'unassigned' }
                );
            }

            // Tasks in new pendingTasks:
            if (toAdd.length > 0) {
                // If previously assigned to another user, remove from their pendingTasks
                await User.updateMany(
                    { _id: { $ne: user._id }, pendingTasks: { $in: toAdd } },
                    { $pull: { pendingTasks: { $in: toAdd } } }
                );

                // Assign to this user
                await Task.updateMany(
                    { _id: { $in: toAdd } },
                    { assignedUser: user._id.toString(), assignedUserName: user.name }
                );
            }

            // If name changed, update assignedUserName on all tasks assigned to this user (including completed)
            if (nameChanged) {
                await Task.updateMany(
                    { assignedUser: user._id.toString() },
                    { assignedUserName: user.name }
                );
            }

            return res.status(200).json({ message: 'User updated', data: user });
        } catch (err) {
            return res.status(500).json({ message: 'Internal Server Error', data: 'An unexpected error occurred' });
        }
    });

    // DELETE /api/users/:id
    userDetailRoute.delete(async function (req, res) {
        try {
            if (!isValidObjectId(req.params.id)) {
                return res.status(404).json({ message: 'Not Found', data: 'User not found' });
            }

            const user = await User.findById(req.params.id);
            if (!user) {
                return res.status(404).json({ message: 'Not Found', data: 'User not found' });
            }

            // Unassign all tasks assigned to this user (completed too)
            await Task.updateMany(
                { assignedUser: user._id.toString() },
                { assignedUser: '', assignedUserName: 'unassigned' }
            );

            await User.deleteOne({ _id: user._id });

            return res.status(204).send();
        } catch (err) {
            return res.status(500).json({ message: 'Internal Server Error', data: 'An unexpected error occurred' });
        }
    });

    return router;
};

